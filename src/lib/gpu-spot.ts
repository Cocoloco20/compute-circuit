/**
 * GPU spot-price tracker — median $/GPU-hr across the public rental market.
 *
 * Two free, no-auth sources combined into a single snapshot per (gpu_model, source):
 *
 *   * Vast.ai — console.vast.ai/api/v0/bundles/. The full public order book.
 *     Filter verified=true + rentable=true, group by gpu_name, compute median of
 *     dph_total/num_gpus (dph_total is the bundle total cost; we want per-GPU).
 *     Hard limit of 1000 listings/query covers the entire active book today
 *     (we typically see ~700 verified+rentable offers globally).
 *
 *   * RunPod — api.runpod.io/graphql, public query (no auth). gpuTypes returns
 *     securePrice (data-center grade) + communityPrice (peer-to-peer). We read
 *     securePrice as "production" rate. The historic spotPrice field was
 *     deprecated; we tolerate its absence.
 *
 * Filtering: we ignore everything but the 8 canonical models the strategic
 * roadmap cares about (case-insensitive partial match):
 *   H100 80GB SXM5, H100 80GB PCIe, H200, B200, A100 80GB, A100 40GB,
 *   RTX 4090, RTX 3090.
 * Joke/exotic GPUs (B300, GTX 1080 Ti, RTX 5060 Ti, etc.) get dropped.
 *
 * Polite UA included on every request. Returns null/[] on any error — the
 * cron treats null/empty as "skip this run".
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

// ---------- canonical models ----------
//
// The roadmap calls out 8 models. Each entry has:
//   * canonical: the label we store in gpu_spot_prices.gpu_model
//   * vastMatches: substrings to look for inside Vast.ai's gpu_name
//   * runpodMatches: substrings to look for inside RunPod's displayName
//   * vastVramMin/Max: optional VRAM gate (GB) — disambiguates A100 40GB vs
//     80GB on Vast, where both surface as gpu_name="A100 SXM4"/"A100 PCIE".
//
// Matches are tried in array order; first hit wins, so put the most specific
// patterns first.

export interface GpuCanonical {
  canonical: string
  vastMatches: Array<{ name: string; vramMin?: number; vramMax?: number }>
  runpodMatches: string[]   // matched against displayName, case-insensitive substring
}

export const CANONICAL_GPUS: GpuCanonical[] = [
  {
    canonical: 'H100 80GB SXM5',
    vastMatches: [{ name: 'H100 SXM' }],
    runpodMatches: ['H100 SXM', 'H100 80GB HBM3'],
  },
  {
    canonical: 'H100 80GB PCIe',
    // H100 NVL is the 94GB PCIe variant — it's the "PCIe-form-factor H100"
    // most renters see; group it under PCIe so we have at least one row.
    vastMatches: [{ name: 'H100 PCIE' }, { name: 'H100 NVL' }],
    runpodMatches: ['H100 PCIe', 'H100 NVL'],
  },
  {
    canonical: 'H200',
    vastMatches: [{ name: 'H200' }],     // catches "H200" and "H200 NVL"
    runpodMatches: ['H200'],
  },
  {
    canonical: 'B200',
    vastMatches: [{ name: 'B200' }],
    runpodMatches: ['B200'],
  },
  {
    canonical: 'A100 80GB',
    // Vast surfaces A100 SXM4 + A100 PCIE for both 40 and 80GB variants —
    // disambiguate by VRAM. A100 80GB has gpu_ram ≈ 81920 MB; 40GB ≈ 40960.
    vastMatches: [
      { name: 'A100 SXM4', vramMin: 70000 },
      { name: 'A100 PCIE', vramMin: 70000 },
    ],
    runpodMatches: ['A100 80GB', 'A100 SXM4-80GB', 'A100-SXM4-80GB', 'A100 SXM'],
  },
  {
    canonical: 'A100 40GB',
    vastMatches: [
      { name: 'A100 SXM4', vramMax: 70000 },
      { name: 'A100 PCIE', vramMax: 70000 },
    ],
    runpodMatches: ['A100 SXM 40GB', 'A100-SXM4-40GB', 'A100 40GB'],
  },
  {
    canonical: 'RTX 4090',
    // Strict: must NOT contain "Ti" (RTX 4090 Ti is a different chip).
    vastMatches: [{ name: 'RTX 4090' }],
    runpodMatches: ['RTX 4090'],
  },
  {
    canonical: 'RTX 3090',
    // Strict: NOT "Ti".
    vastMatches: [{ name: 'RTX 3090' }],
    runpodMatches: ['RTX 3090'],
  },
]

// ---------- types ----------

export interface VastBundle {
  gpu_name: string
  dph_total: number          // $/hr for the WHOLE bundle (num_gpus GPUs)
  num_gpus: number
  gpu_ram: number            // single-GPU VRAM in MB
  verification?: string
  rentable?: boolean
}

export interface RunpodGpuType {
  id: string
  displayName: string
  memoryInGb: number | null
  securePrice: number | null     // data-center grade $/hr per GPU
  communityPrice: number | null  // peer-to-peer $/hr per GPU
  spotPrice?: number | null      // historic field, often null/missing
}

export interface GpuSpotSnapshot {
  snapshot_date: string          // YYYY-MM-DD (UTC)
  gpu_model: string              // one of CANONICAL_GPUS[].canonical
  source: 'vast.ai' | 'runpod' | 'blended'
  median_usd_per_hour: number
  p25_usd_per_hour: number | null
  p75_usd_per_hour: number | null
  listing_count: number
}

// ---------- fetchers ----------

const VAST_BUNDLES_URL =
  'https://console.vast.ai/api/v0/bundles/?q=' +
  encodeURIComponent(JSON.stringify({
    verified: { eq: true },
    rentable: { eq: true },
    // disk_space gte 0 is a no-op filter — Vast.ai requires at least one
    // numeric range condition for limit to take effect. Without it, the API
    // silently returns an empty offers array.
    disk_space: { gte: 0 },
    limit: 1000,
  }))

export async function fetchVastAiBundles(): Promise<VastBundle[]> {
  try {
    const r = await fetch(VAST_BUNDLES_URL, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!r.ok) return []
    const body = (await r.json()) as { offers?: VastBundle[] }
    return Array.isArray(body.offers) ? body.offers : []
  } catch {
    return []
  }
}

const RUNPOD_QUERY = '{ gpuTypes { id displayName memoryInGb securePrice communityPrice } }'

export async function fetchRunpodGpuTypes(): Promise<RunpodGpuType[]> {
  try {
    const r = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: RUNPOD_QUERY }),
    })
    if (!r.ok) return []
    const body = (await r.json()) as { data?: { gpuTypes?: RunpodGpuType[] } }
    return Array.isArray(body.data?.gpuTypes) ? body.data!.gpuTypes : []
  } catch {
    return []
  }
}

// ---------- aggregation ----------

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = arr.slice().sort((a, b) => a - b)
  const n = s.length
  return n % 2 === 1 ? s[Math.floor(n / 2)] : (s[n / 2 - 1] + s[n / 2]) / 2
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null
  const s = arr.slice().sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))
  return s[i]
}

/** Vast.ai → per-GPU rate, but only for our canonical models. */
function vastPricesByModel(bundles: VastBundle[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const b of bundles) {
    if (!b.rentable || b.verification !== 'verified') continue
    const n = Number(b.num_gpus)
    const dph = Number(b.dph_total)
    if (!Number.isFinite(n) || n <= 0) continue
    if (!Number.isFinite(dph) || dph <= 0) continue
    const perGpu = dph / n
    // Sanity gate: anything > $30/hr/GPU is either a joke listing or a billing
    // glitch (B300 SXM6 AC tops out around $10/hr today).
    if (perGpu > 30) continue
    const name = (b.gpu_name ?? '').trim()
    if (!name) continue
    const vram = Number(b.gpu_ram) || 0   // single-GPU VRAM, MB

    // Exclude "Ti" variants for plain RTX 4090 / RTX 3090 (separate chips).
    const isPlainRtx4090 = /\bRTX\s*4090\b/i.test(name) && !/\bTi\b/i.test(name)
    const isPlainRtx3090 = /\bRTX\s*3090\b/i.test(name) && !/\bTi\b/i.test(name)

    for (const spec of CANONICAL_GPUS) {
      // Skip exclusive variants
      if (spec.canonical === 'RTX 4090' && !isPlainRtx4090) continue
      if (spec.canonical === 'RTX 3090' && !isPlainRtx3090) continue

      const hit = spec.vastMatches.find(m => {
        if (!name.toLowerCase().includes(m.name.toLowerCase())) return false
        if (m.vramMin != null && vram < m.vramMin) return false
        if (m.vramMax != null && vram >= m.vramMax) return false
        return true
      })
      if (!hit) continue
      const arr = out.get(spec.canonical) ?? []
      arr.push(perGpu)
      out.set(spec.canonical, arr)
      break  // first canonical match wins
    }
  }
  return out
}

/** RunPod → use securePrice (data-center rate). */
function runpodPricesByModel(gpus: RunpodGpuType[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const g of gpus) {
    const price = Number(g.securePrice)
    if (!Number.isFinite(price) || price <= 0) continue
    const name = (g.displayName ?? '').trim()
    if (!name) continue
    // Exclude Ti variants for plain RTX 4090 / 3090
    const isPlainRtx4090 = /\bRTX\s*4090\b/i.test(name) && !/\bTi\b/i.test(name)
    const isPlainRtx3090 = /\bRTX\s*3090\b/i.test(name) && !/\bTi\b/i.test(name)

    for (const spec of CANONICAL_GPUS) {
      if (spec.canonical === 'RTX 4090' && !isPlainRtx4090) continue
      if (spec.canonical === 'RTX 3090' && !isPlainRtx3090) continue
      const hit = spec.runpodMatches.some(m => name.toLowerCase().includes(m.toLowerCase()))
      if (!hit) continue
      // Disambiguate A100 80GB vs 40GB on RunPod by memoryInGb
      if (spec.canonical === 'A100 80GB' && (g.memoryInGb ?? 0) < 70) continue
      if (spec.canonical === 'A100 40GB' && (g.memoryInGb ?? 0) >= 70) continue
      const arr = out.get(spec.canonical) ?? []
      arr.push(price)
      out.set(spec.canonical, arr)
      break
    }
  }
  return out
}

/**
 * Aggregate Vast.ai + RunPod into one row per (gpu_model, source). The
 * 'blended' source is the median across the combined book — that's the
 * line we put on the supply-chain chip.
 *
 * snapshot_date defaults to today's UTC date.
 */
export function aggregateGpuSpot(
  bundles: VastBundle[],
  runpods: RunpodGpuType[],
  snapshotDate: string = new Date().toISOString().slice(0, 10),
): GpuSpotSnapshot[] {
  const vastByModel = vastPricesByModel(bundles)
  const runpodByModel = runpodPricesByModel(runpods)

  const rows: GpuSpotSnapshot[] = []

  for (const spec of CANONICAL_GPUS) {
    const vast = vastByModel.get(spec.canonical) ?? []
    const runpod = runpodByModel.get(spec.canonical) ?? []
    const blended = vast.concat(runpod)

    if (vast.length > 0) {
      rows.push({
        snapshot_date: snapshotDate,
        gpu_model: spec.canonical,
        source: 'vast.ai',
        median_usd_per_hour: round3(median(vast)),
        p25_usd_per_hour: roundOrNull(percentile(vast, 25)),
        p75_usd_per_hour: roundOrNull(percentile(vast, 75)),
        listing_count: vast.length,
      })
    }
    if (runpod.length > 0) {
      rows.push({
        snapshot_date: snapshotDate,
        gpu_model: spec.canonical,
        source: 'runpod',
        median_usd_per_hour: round3(median(runpod)),
        p25_usd_per_hour: roundOrNull(percentile(runpod, 25)),
        p75_usd_per_hour: roundOrNull(percentile(runpod, 75)),
        listing_count: runpod.length,
      })
    }
    if (blended.length > 0) {
      rows.push({
        snapshot_date: snapshotDate,
        gpu_model: spec.canonical,
        source: 'blended',
        median_usd_per_hour: round3(median(blended)),
        p25_usd_per_hour: roundOrNull(percentile(blended, 25)),
        p75_usd_per_hour: roundOrNull(percentile(blended, 75)),
        listing_count: blended.length,
      })
    }
  }

  return rows
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

function roundOrNull(v: number | null): number | null {
  return v == null ? null : round3(v)
}
