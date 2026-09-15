/**
 * Shared display formatters. `usd` used to live in fund-data.ts (the VC
 * terminal, archived at tag vc-terminal-final); the ledger kept using it.
 */

export function usd(n: number | null | undefined): string {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
