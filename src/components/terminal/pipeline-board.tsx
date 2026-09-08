'use client'

/**
 * The pipeline, as a list with a stage dropdown per row.
 *
 * A list and not a drag-and-drop kanban on purpose: dragging is fun once and
 * tedious forever, it's unusable on a phone, and it makes an irreversible
 * stage change one slipped mouse away. A dropdown is boring, keyboard-
 * reachable, and — crucially — gives us a place to interrupt the move and
 * demand the reasoning.
 *
 * The interruption is the feature. Moving a card to Passed, Term Sheet or
 * Closed opens Decision Capture and the move does not commit until the form
 * does. The server enforces the same rule, so this is a nicety, not the
 * guarantee.
 */

import { useMemo, useState } from 'react'
import DecisionForm, { type DecisionPayload } from '@/components/terminal/decision-form'
import { getClientKey } from '@/lib/watchlist-store'
import { supabaseBrowser } from '@/lib/supabase/client'
import type { PipelineStage, DecisionOutcome } from '@/types/db'
import type { BoardRow } from '@/lib/pipeline-data'

const STAGES: PipelineStage[] =
  ['Sourcing', 'Screening', 'DD', 'Term Sheet', 'Closed', 'Passed']

/** Kept in sync with STAGES_REQUIRING_DECISION in lib/decisions.ts. */
const GATED: PipelineStage[] = ['Passed', 'Closed', 'Term Sheet']
const STAGE_OUTCOME: Partial<Record<PipelineStage, DecisionOutcome>> = {
  Passed: 'Pass', 'Term Sheet': 'Advance', Closed: 'Invest',
}

const STALE_STAGE_DAYS = 14

export default function PipelineBoard({ rows, stale }: { rows: BoardRow[]; stale: number }) {
  const [filter, setFilter] = useState<PipelineStage | 'All'>('All')
  const [pending, setPending] = useState<{ row: BoardRow; stage: PipelineStage } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const shown = useMemo(
    () => filter === 'All' ? rows : rows.filter(r => r.stage === filter),
    [rows, filter])

  async function move(row: BoardRow, stage: PipelineStage, decision?: DecisionPayload): Promise<string | null> {
    const key = getClientKey()
    if (!key) return 'A CRON_SECRET is required to move cards.'
    setBusy(row.companyId)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ company_id: row.companyId, stage, decision }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.localStorage.removeItem('cc_key')
        return 'Key rejected — try again.'
      }
      if (!res.ok) return body?.error ?? 'Move failed.'
      return null
    } catch {
      return 'Network error — nothing moved.'
    } finally {
      setBusy(null)
    }
  }

  async function onStageChange(row: BoardRow, stage: PipelineStage) {
    if (stage === row.stage) return
    if (GATED.includes(stage)) { setPending({ row, stage }); return }
    const err = await move(row, stage)
    if (err) { setToast(err); return }
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" active={filter === 'All'} onClick={() => setFilter('All')} count={rows.length} />
        {STAGES.map(s => (
          <FilterChip
            key={s}
            label={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            count={rows.filter(r => r.stage === s).length}
          />
        ))}
        <div className="ml-auto flex items-center gap-3">
          {stale > 0 && (
            <span className="text-[11px] text-[#FBBF24]">
              <span className="tabular-nums">{stale}</span> stalled &gt;{STALE_STAGE_DAYS}d
            </span>
          )}
          <button
            onClick={() => setAdding(true)}
            className="rounded border border-[#3A3F4B] bg-[#13151C] px-3 py-1.5 text-xs font-medium text-[#F2F3F5] hover:bg-[#1B1E26]"
          >Add company</button>
        </div>
      </div>

      {toast && (
        <p className="rounded border border-[#F87171]/40 bg-[#F87171]/10 px-3 py-2 text-xs text-[#F87171]">
          {toast}{' '}
          <button onClick={() => setToast(null)} className="underline">dismiss</button>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-[#1B1E26] bg-[#0D0E13] px-4 py-6 text-sm text-[#6B6F7A]">
          {rows.length === 0
            ? 'Pipeline is empty. Add a company to start the funnel.'
            : `No companies in ${filter}.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#1B1E26] bg-[#0D0E13]">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-[#1B1E26] text-left text-[10px] uppercase tracking-wider text-[#6B6F7A]">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Sector</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 text-right font-medium">In stage</th>
                <th className="px-4 py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#131519]">
              {shown.map(r => (
                <tr key={r.companyId} className={busy === r.companyId ? 'opacity-50' : 'hover:bg-[#13151C]'}>
                  <td className="px-4 py-2.5">
                    {r.flag && <span className="mr-1.5 text-[#FBBF24]" title="Flagged">⚠</span>}
                    <span className="font-medium">{r.company}</span>
                    {r.actionNeeded && (
                      <span className="ml-2 text-[11px] text-[#6B6F7A]">{r.actionNeeded}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[#6B6F7A]">{r.sector ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={r.stage}
                      disabled={busy === r.companyId}
                      onChange={e => void onStageChange(r, e.target.value as PipelineStage)}
                      className="rounded border border-[#262A33] bg-[#13151C] px-1.5 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none"
                    >
                      {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#A5A8B0]">
                    {r.amountUsd == null ? '—' : `$${(r.amountUsd / 1e6).toFixed(1)}M`}
                  </td>
                  <td className="px-4 py-2.5 text-[#A5A8B0]">{r.lead ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={r.daysInStage > STALE_STAGE_DAYS ? 'text-[#F87171]' : 'text-[#6B6F7A]'}>
                      {r.daysInStage}d
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#6B6F7A]">{r.owner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <DecisionForm
          title={`Move to ${pending.stage}`}
          company={{ id: pending.row.companyId, name: pending.row.company }}
          lockCompany
          presetOutcome={STAGE_OUTCOME[pending.stage]}
          submitLabel={`Save & move to ${pending.stage}`}
          onClose={() => setPending(null)}
          onSubmit={async (_company, payload) => move(pending.row, pending.stage, payload)}
        />
      )}

      {adding && <AddCompany onClose={() => setAdding(false)} onError={setToast} />}
    </div>
  )
}

function FilterChip({ label, active, onClick, count }: {
  label: string; active: boolean; onClick: () => void; count: number
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-[#A78BFA] bg-[#A78BFA]/15 text-[#F2F3F5]'
          : 'border-[#262A33] bg-[#13151C] text-[#A5A8B0] hover:bg-[#1B1E26]',
      ].join(' ')}
    >
      {label} <span className="tabular-nums text-[#6B6F7A]">{count}</span>
    </button>
  )
}

/**
 * Sourcing entry. Cards always come in at Sourcing or Screening — the server
 * rejects creating one directly at a gated stage, because that would be a way
 * to record a pass without recording why.
 */
function AddCompany({ onClose, onError }: {
  onClose: () => void; onError: (m: string) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ id: string; name: string; ticker: string | null }>>([])
  const [stage, setStage] = useState<PipelineStage>('Sourcing')
  const [saving, setSaving] = useState(false)

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setHits([]); return }
    const { data } = await supabaseBrowser()
      .from('companies').select('id, name, ticker').ilike('name', `%${q.trim()}%`).limit(8)
    setHits((data ?? []) as Array<{ id: string; name: string; ticker: string | null }>)
  }

  async function add(id: string) {
    const key = getClientKey()
    if (!key) { onError('A CRON_SECRET is required to add companies.'); onClose(); return }
    setSaving(true)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ company_id: id, stage }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { onError(body?.error ?? 'Could not add.'); onClose(); return }
      window.location.reload()
    } catch {
      onError('Network error — nothing added.')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg border border-[#262A33] bg-[#0A0B0F] shadow-2xl">
        <header className="border-b border-[#1B1E26] px-4 py-3">
          <h2 className="text-sm font-semibold">Add to pipeline</h2>
        </header>
        <div className="space-y-3 p-4">
          <input
            autoFocus
            value={query}
            onChange={e => void search(e.target.value)}
            placeholder="Search the 2,461 tracked companies…"
            className="w-full rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">Enter at</span>
            <select
              value={stage}
              onChange={e => setStage(e.target.value as PipelineStage)}
              className="rounded border border-[#262A33] bg-[#13151C] px-2 py-1 text-xs text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none"
            >
              {(['Sourcing', 'Screening', 'DD'] as PipelineStage[]).map(s =>
                <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {hits.length > 0 && (
            <ul className="max-h-64 divide-y divide-[#1B1E26] overflow-y-auto rounded border border-[#262A33] bg-[#13151C]">
              {hits.map(h => (
                <li key={h.id}>
                  <button
                    disabled={saving}
                    onClick={() => void add(h.id)}
                    className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-[#1B1E26] disabled:opacity-40"
                  >
                    <span>{h.name}</span>
                    {h.ticker && <span className="text-[11px] text-[#6B6F7A]">{h.ticker.toUpperCase()}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="flex justify-end border-t border-[#1B1E26] px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-[#A5A8B0] hover:text-[#F2F3F5]">Close</button>
        </footer>
      </div>
    </div>
  )
}
