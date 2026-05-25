/**
 * Hugging Face Hub API client.
 *
 * Free, no auth needed for public org reads. Endpoint:
 *   GET https://huggingface.co/api/models?author=<org>&limit=1000&sort=downloads&direction=-1
 *
 * Returns one row per public model. We aggregate per org:
 *   - model_count
 *   - total_downloads_30d (sum of `downloads`, which HF defines as last-30-day)
 *   - top_model_id + top_model_downloads (already sorted DESC)
 *   - last_release_date (max lastModified)
 *
 * Anthropic / Broadcom / CoreWeave have verified orgs with 0 public models —
 * the API returns []. We treat that as a valid empty snapshot, not an error.
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'

interface HfModel {
  id?: string
  downloads?: number
  likes?: number
  lastModified?: string  // ISO timestamp
}

export interface HfOrgSnapshot {
  org: string
  modelCount: number
  totalDownloads30d: number
  topModelId: string | null
  topModelDownloads: number | null
  lastReleaseDate: string | null  // YYYY-MM-DD
}

export async function fetchHfOrg(org: string): Promise<HfOrgSnapshot | null> {
  const url = `https://huggingface.co/api/models?author=${encodeURIComponent(org)}&limit=1000&sort=downloads&direction=-1`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return null
    const models = (await r.json()) as HfModel[]
    if (!Array.isArray(models)) return null

    let totalDownloads = 0
    let lastMod = ''
    let topId: string | null = null
    let topDownloads: number | null = null
    for (const m of models) {
      const d = Number(m.downloads ?? 0)
      if (Number.isFinite(d)) totalDownloads += d
      if (m.lastModified && m.lastModified > lastMod) lastMod = m.lastModified
      if (topId === null && m.id) {
        topId = m.id
        topDownloads = Number.isFinite(d) ? d : null
      }
    }

    return {
      org,
      modelCount: models.length,
      totalDownloads30d: totalDownloads,
      topModelId: topId,
      topModelDownloads: topDownloads,
      lastReleaseDate: lastMod ? lastMod.slice(0, 10) : null,
    }
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Fetch HF stats for many orgs sequentially (HF doesn't appear to throttle but be polite). */
export async function fetchAllHfOrgs(orgs: Array<{ companyId: string; org: string }>): Promise<Array<{ companyId: string; snap: HfOrgSnapshot | null }>> {
  const out: Array<{ companyId: string; snap: HfOrgSnapshot | null }> = []
  for (const c of orgs) {
    const snap = await fetchHfOrg(c.org)
    out.push({ companyId: c.companyId, snap })
    await sleep(80)
  }
  return out
}
