/**
 * Bitcoin network signal — proxy for global compute spend.
 *
 * Hashrate rising = the world is buying more ASICs and renting more grid
 * power, which is the economic backdrop for our AI-compute thesis. When
 * miners ramp, they compete with hyperscalers for the same megawatts, the
 * same fab capacity (TSMC N5/N4), and the same grid interconnects.
 *
 * Data source: mempool.space free API.
 *   - https://mempool.space/api/v1/mining/hashrate/3d
 *       Most recent 3-day window of hashrate + currentDifficulty.
 *   - https://mempool.space/api/v1/mining/difficulty-adjustments
 *       Full history of difficulty adjustments — each row is
 *       [timestamp, block_height, difficulty, change_multiplier].
 *
 * No auth, rate limit 100 req/hour. Polite UA included.
 *
 * Power estimate uses modern fleet efficiency of 25 J/TH (rough industry
 * blend across S19j Pros, S21s, and equivalent Whatsminer/Avalon gear).
 *   Power_W = hashrate_TH/s × 25
 *   Hashrate_EH/s = hashrate_TH/s × 1e-6
 *   Power_MW = hashrate_EH/s × 25_000
 * At ~600 EH/s this yields ~15 GW, in line with CCAF / Cambridge BECI
 * estimates of network draw.
 *
 * Returns null on any error — the cron treats null as "skip this run".
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com'
const MEMPOOL_BASE = 'https://mempool.space/api/v1/mining'

/** Joules-per-terahash for a modern ASIC fleet blend (S19j Pro ≈ 22, S21 ≈ 16, older gear 30+). */
const FLEET_J_PER_TH = 25

export interface BtcNetworkSnapshot {
  hashrate_ehs: number       // exahashes/sec
  difficulty: number         // raw difficulty target
  last_adj_pct: number       // % change at most recent retarget (positive = harder)
  est_network_mw: number     // estimated power draw in MW at FLEET_J_PER_TH
  snapshot_date: string      // YYYY-MM-DD (UTC)
}

interface HashrateResponse {
  hashrates?: Array<{ timestamp: number; avgHashrate: number }>
  currentHashrate?: number
  currentDifficulty?: number
}

// Difficulty-adjustment rows: [timestamp, block_height, difficulty, change_multiplier]
// change_multiplier of 1.03121 means +3.121% adjustment.
type DifficultyAdjustment = [number, number, number, number]

export async function fetchBtcNetwork(): Promise<BtcNetworkSnapshot | null> {
  try {
    const [hashRes, adjRes] = await Promise.all([
      fetch(`${MEMPOOL_BASE}/hashrate/3d`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      }),
      fetch(`${MEMPOOL_BASE}/difficulty-adjustments`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      }),
    ])
    if (!hashRes.ok || !adjRes.ok) return null

    const hash = (await hashRes.json()) as HashrateResponse
    const adjustments = (await adjRes.json()) as DifficultyAdjustment[]

    const currentHashRaw = Number(hash.currentHashrate)
    const currentDifficulty = Number(hash.currentDifficulty)
    if (!Number.isFinite(currentHashRaw) || currentHashRaw <= 0) return null
    if (!Number.isFinite(currentDifficulty) || currentDifficulty <= 0) return null

    // API returns hashrate in H/s. Convert to EH/s (×1e-18) and to TH/s for power calc.
    const hashrate_ehs = currentHashRaw / 1e18
    const hashrate_ths = currentHashRaw / 1e12
    const est_network_mw = (hashrate_ths * FLEET_J_PER_TH) / 1e6 // W → MW

    // Most recent adjustment is row 0; column 3 is the change multiplier (1.03121 = +3.121%).
    let last_adj_pct = 0
    if (Array.isArray(adjustments) && adjustments.length > 0) {
      const mult = Number(adjustments[0]?.[3])
      if (Number.isFinite(mult)) last_adj_pct = (mult - 1) * 100
    }

    return {
      hashrate_ehs: Math.round(hashrate_ehs * 100) / 100,
      difficulty: Math.round(currentDifficulty),
      last_adj_pct: Math.round(last_adj_pct * 100) / 100,
      est_network_mw: Math.round(est_network_mw),
      snapshot_date: new Date().toISOString().slice(0, 10),
    }
  } catch {
    return null
  }
}
