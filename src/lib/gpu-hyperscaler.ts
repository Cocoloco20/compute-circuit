/**
 * src/lib/gpu-hyperscaler.ts
 *
 * Spot pricing fetchers for AWS and Azure GPU instances.
 * Returns normalized rows ready for upsert into gpu_hyperscaler_pricing.
 *
 * Supported GPU families:
 *   AWS p5.48xlarge    → H100 80GB SXM5 × 8  ($  / 8 GPU/instance)
 *   AWS p5e.48xlarge   → H200              × 8
 *   AWS p5en.48xlarge  → B200              × 8
 *   AWS p4d.24xlarge   → A100 80GB         × 8
 *   Azure ND H100 v5   → H100 80GB SXM5    × 8  (96 vCPU VM)
 *   Azure NC H100 v4   → H100 80GB SXM5    × 8  (96 vCPU VM)
 *
 * Politeness:
 *   - UA header on every request
 *   - Caller should sleep 1s between providers (handled in route.ts)
 *   - Azure pagination capped at 3 pages (~300 rows max)
 *
 * Returns null on total failure; returns [] if provider returns data but
 * no matching GPU families found.
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface GpuHyperscalerRow {
  snapshot_date: string
  gpu_model: string                     // canonical name matching CANONICAL_GPUS
  provider: 'aws' | 'azure' | 'gcp'
  region: string                        // provider-native region string
  spot_usd_per_gpu_hour: number | null
  on_demand_usd_per_gpu_hour: number | null
}

// ---------------------------------------------------------------------------
// AWS Spot Pricing
// ---------------------------------------------------------------------------

// Maps AWS instance type → { canonical gpu_model, gpu_count }
const AWS_INSTANCE_MAP: Record<string, { gpuModel: string; gpuCount: number }> = {
  'p5.48xlarge':   { gpuModel: 'H100 80GB SXM5', gpuCount: 8 },
  'p5e.48xlarge':  { gpuModel: 'H200',            gpuCount: 8 },
  'p5en.48xlarge': { gpuModel: 'B200',            gpuCount: 8 },
  'p4d.24xlarge':  { gpuModel: 'A100 80GB',       gpuCount: 8 },
}

interface AwsSpotItem {
  InstanceType: string
  SpotPrice: string      // e.g. "2.3456"
  AvailabilityZone: string
  Timestamp: string
}

interface AwsSpotResponse {
  SpotPriceHistory?: AwsSpotItem[]
}

/**
 * Fetches AWS spot price history JSON and returns the latest spot price
 * per (instance_type, region) for our GPU families.
 *
 * AWS public spot price JSON is a large payload (~2MB) with history for
 * all instance types. We filter client-side to our four families. The
 * prices are sorted newest-first by the API, so we take the first hit
 * per (instance_type, region).
 *
 * Note: AvailabilityZone in the response is the AZ (e.g. "us-east-1a"),
 * not the region. We strip the trailing letter(s) to get the region.
 */
export async function fetchAwsSpotPricing(
  snapshotDate: string = new Date().toISOString().slice(0, 10),
): Promise<GpuHyperscalerRow[]> {
  const url = 'https://spot-price.s3.amazonaws.com/spot.js'
  // AWS also publishes a cleaner JSON endpoint — prefer it.
  // Some mirrors exist; we try the canonical S3 one.
  // The response is actually JSONP: callback({ ... }) — we strip the wrapper.
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
    })
    if (!r.ok) return await fetchAwsSpotFallback(snapshotDate)
    const raw = await r.text()
    return parseAwsJsonp(raw, snapshotDate)
  } catch {
    return await fetchAwsSpotFallback(snapshotDate)
  }
}

/** Fallback: try the documented spot-price-history S3 endpoint (JSON, paginated). */
async function fetchAwsSpotFallback(snapshotDate: string): Promise<GpuHyperscalerRow[]> {
  // Build a per-instance filter string for the four families
  const instanceTypes = Object.keys(AWS_INSTANCE_MAP).join(',')
  const url = `https://prod-spot-pricing.s3.amazonaws.com/spot-price-history.json?instance-type=${encodeURIComponent(instanceTypes)}`
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return []
    const body = (await r.json()) as AwsSpotResponse
    return normalizeAwsSpotHistory(body.SpotPriceHistory ?? [], snapshotDate)
  } catch {
    return []
  }
}

function azToRegion(az: string): string {
  // "us-east-1a" → "us-east-1", "eu-west-1b" → "eu-west-1"
  return az.replace(/[a-z]$/, '')
}

function normalizeAwsSpotHistory(items: AwsSpotItem[], snapshotDate: string): GpuHyperscalerRow[] {
  // Dedupe to cheapest price per (gpu_model, region) — items are newest-first
  const best = new Map<string, GpuHyperscalerRow>()
  for (const item of items) {
    const spec = AWS_INSTANCE_MAP[item.InstanceType]
    if (!spec) continue
    const price = parseFloat(item.SpotPrice)
    if (!Number.isFinite(price) || price <= 0) continue
    const region = azToRegion(item.AvailabilityZone)
    const key = `${spec.gpuModel}::${region}`
    const perGpu = round4(price / spec.gpuCount)
    const existing = best.get(key)
    if (!existing || perGpu < (existing.spot_usd_per_gpu_hour ?? Infinity)) {
      best.set(key, {
        snapshot_date: snapshotDate,
        gpu_model: spec.gpuModel,
        provider: 'aws',
        region,
        spot_usd_per_gpu_hour: perGpu,
        on_demand_usd_per_gpu_hour: null,
      })
    }
  }
  return [...best.values()]
}

/**
 * AWS also exposes a JSONP endpoint (spot.js) with a different schema:
 * callback({ config: { regions: [{ region, instanceTypes: [{ type, sizes: [{ size, valueColumns: [...] }] }] }] } })
 */
interface AwsJsonpSize {
  size: string
  valueColumns: Array<{ name: string; prices: { USD: string } }>
}
interface AwsJsonpInstanceType {
  type: string
  sizes: AwsJsonpSize[]
}
interface AwsJsonpRegion {
  region: string
  instanceTypes: AwsJsonpInstanceType[]
}

function parseAwsJsonp(raw: string, snapshotDate: string): GpuHyperscalerRow[] {
  try {
    // Strip JSONP wrapper: "callback({...})" or "callback( {...} )"
    const match = raw.match(/callback\s*\(\s*(\{[\s\S]*\})\s*\)/)
    if (!match) return []
    const body = JSON.parse(match[1]) as {
      config?: { regions?: AwsJsonpRegion[] }
    }
    const regions = body?.config?.regions ?? []
    const rows: GpuHyperscalerRow[] = []

    // Map short region names used in JSONP to real region identifiers
    const REGION_MAP: Record<string, string> = {
      'us-east':     'us-east-1',
      'us-west':     'us-west-2',
      'eu-ireland':  'eu-west-1',
      'eu-frankfurt':'eu-central-1',
      'apac-tokyo':  'ap-northeast-1',
      'apac-singapore': 'ap-southeast-1',
    }

    for (const reg of regions) {
      const region = REGION_MAP[reg.region] ?? reg.region
      for (const it of reg.instanceTypes ?? []) {
        for (const sz of it.sizes ?? []) {
          const spec = AWS_INSTANCE_MAP[sz.size]
          if (!spec) continue
          const col = sz.valueColumns.find(v => v.name === 'linux')
          if (!col) continue
          const price = parseFloat(col.prices?.USD ?? '')
          if (!Number.isFinite(price) || price <= 0) continue
          rows.push({
            snapshot_date: snapshotDate,
            gpu_model: spec.gpuModel,
            provider: 'aws',
            region,
            spot_usd_per_gpu_hour: round4(price / spec.gpuCount),
            on_demand_usd_per_gpu_hour: null,
          })
        }
      }
    }
    return rows
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Azure Spot Pricing
// ---------------------------------------------------------------------------

// Maps Azure SKU name patterns → { canonical gpu_model, gpu_count }
const AZURE_SKU_MAP: Array<{ pattern: string; gpuModel: string; gpuCount: number }> = [
  { pattern: 'ND H100 v5',   gpuModel: 'H100 80GB SXM5', gpuCount: 8 },
  { pattern: 'NC H100 v4',   gpuModel: 'H100 80GB SXM5', gpuCount: 8 },
  { pattern: 'ND H200 v5',   gpuModel: 'H200',            gpuCount: 8 },
]

interface AzurePriceItem {
  skuName: string
  retailPrice: number
  unitOfMeasure: string   // '1 Hour'
  armRegionName: string   // e.g. 'eastus'
  priceType: string       // 'Spot' | 'Retail'
}

interface AzurePriceResponse {
  Items: AzurePriceItem[]
  NextPageLink: string | null
}

/**
 * Fetches Azure spot VM prices for GPU SKUs.
 * Paginates up to 3 pages to stay polite. Each page ~100 items.
 */
export async function fetchAzureSpotPricing(
  snapshotDate: string = new Date().toISOString().slice(0, 10),
): Promise<GpuHyperscalerRow[]> {
  const skuFilter = AZURE_SKU_MAP.map(s => `skuName eq '${s.pattern}'`).join(' or ')
  const baseUrl =
    `https://prices.azure.com/api/retail/prices?$filter=` +
    `serviceName eq 'Virtual Machines' and priceType eq 'Spot' and (${skuFilter})`

  const allItems: AzurePriceItem[] = []
  let nextUrl: string | null = baseUrl
  let page = 0

  while (nextUrl && page < 3) {
    try {
      const r = await fetch(nextUrl, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      })
      if (!r.ok) break
      const body = (await r.json()) as AzurePriceResponse
      allItems.push(...(body.Items ?? []))
      nextUrl = body.NextPageLink ?? null
      page++
    } catch {
      break
    }
  }

  // Dedupe to cheapest spot per (gpu_model, region)
  const best = new Map<string, GpuHyperscalerRow>()

  for (const item of allItems) {
    if (item.priceType !== 'Spot') continue
    const spec = AZURE_SKU_MAP.find(s =>
      item.skuName.toLowerCase().includes(s.pattern.toLowerCase())
    )
    if (!spec) continue
    const price = item.retailPrice
    if (!Number.isFinite(price) || price <= 0) continue
    const perGpu = round4(price / spec.gpuCount)
    const key = `${spec.gpuModel}::${item.armRegionName}`
    const existing = best.get(key)
    if (!existing || perGpu < (existing.spot_usd_per_gpu_hour ?? Infinity)) {
      best.set(key, {
        snapshot_date: snapshotDate,
        gpu_model: spec.gpuModel,
        provider: 'azure',
        region: item.armRegionName,
        spot_usd_per_gpu_hour: perGpu,
        on_demand_usd_per_gpu_hour: null,
      })
    }
  }

  return [...best.values()]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

/** Sleep helper for politeness between provider fetches. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
