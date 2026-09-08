'use client'

/**
 * The Decision Capture modal, as a reusable form.
 *
 * Two callers submit the same fields to different endpoints:
 *   - DecisionCapture      → POST /api/decisions   (ad-hoc, `d` from anywhere)
 *   - PipelineBoard        → PATCH /api/pipeline   (forced by a stage change)
 *
 * They share this component precisely so the two paths can't drift into
 * asking for different things. The moment a "quick" pass gets a shorter form
 * than a deliberate one, the log stops being comparable and the calibration
 * queries that justify the whole layer become meaningless.
 *
 * Keyboard-first: Tab across, arrows pick chips, ⌘/Ctrl+Enter submits,
 * Esc cancels. Zero mouse required.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/client'
import type { DecisionOutcome, DecisionFactorName } from '@/types/db'

export const OUTCOMES: DecisionOutcome[] = ['Pass', 'Advance', 'Invest']
export const FACTORS: DecisionFactorName[] = [
  'Market Timing', 'Team', 'Product', 'Competition',
  'Traction', 'Valuation', 'Thesis Fit', 'Other',
]
const CONFIDENCE = ['1', '2', '3', '4', '5'] as const

export interface DecisionPayload {
  outcome: DecisionOutcome
  primary_factor: DecisionFactorName
  confidence: number
  reasoning: string
  what_would_change_mind?: string
  dissent: boolean
}

interface CompanyHit { id: string; name: string; ticker: string | null }

export default function DecisionForm({
  title, company, lockCompany, presetOutcome, submitLabel, onClose, onSubmit,
}: {
  title: string
  company?: { id: string; name: string } | null
  /** True when the caller already knows the company (a stage change does). */
  lockCompany?: boolean
  presetOutcome?: DecisionOutcome
  submitLabel?: string
  onClose: () => void
  /** Resolve to an error string to show it; resolve to null on success. */
  onSubmit: (company: { id: string; name: string }, payload: DecisionPayload) => Promise<string | null>
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(company ?? null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CompanyHit[]>([])
  const [outcome, setOutcome] = useState<DecisionOutcome>(presetOutcome ?? 'Pass')
  const [factor, setFactor] = useState<DecisionFactorName>('Market Timing')
  const [confidence, setConfidence] = useState(3)
  const [reasoning, setReasoning] = useState('')
  const [wwcm, setWwcm] = useState('')
  const [dissent, setDissent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const firstField = useRef<HTMLInputElement>(null)
  const reasoningField = useRef<HTMLTextAreaElement>(null)

  // Focus where the work actually starts: the search box when we still need a
  // company, the reasoning box when we already know it.
  useEffect(() => {
    if (picked) reasoningField.current?.focus()
    else firstField.current?.focus()
  }, [picked])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // `companies` is public data and already ships in the graph's SSR payload,
  // so the anon client is fine for lookup. The decision itself goes through
  // the authenticated route — those tables the anon key cannot see at all.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || picked) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser()
        .from('companies').select('id, name, ticker').ilike('name', `%${q}%`).limit(6)
      if (!cancelled) setHits((data ?? []) as CompanyHit[])
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, picked])

  const reasoningOk = reasoning.trim().length >= 10 && reasoning.trim().length <= 500
  const canSave = !!picked && reasoningOk && !saving

  const submit = useCallback(async () => {
    if (!picked || !reasoningOk || saving) return
    setSaving(true); setError(null)
    const err = await onSubmit(picked, {
      outcome,
      primary_factor: factor,
      confidence,
      reasoning: reasoning.trim(),
      what_would_change_mind: wwcm.trim() || undefined,
      dissent,
    })
    if (err) { setError(err); setSaving(false); return }
    setSaved(true)
    setTimeout(() => window.location.reload(), 600)
  }, [picked, reasoningOk, saving, onSubmit, outcome, factor, confidence, reasoning, wwcm, dissent])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit() }
        }}
        className="w-full max-w-lg rounded-lg border border-[#262A33] bg-[#0A0B0F] shadow-2xl"
      >
        <header className="flex items-baseline justify-between gap-3 border-b border-[#1B1E26] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#F2F3F5]">
            {title}{picked ? `: ${picked.name}` : ''}
          </h2>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-[#6B6F7A]">⌘↵ save · esc cancel</span>
        </header>

        <div className="space-y-4 p-4">
          {picked ? (
            <Field label="Company">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#F2F3F5]">{picked.name}</span>
                {!lockCompany && (
                  <button
                    onClick={() => { setPicked(null); setQuery('') }}
                    className="text-[11px] text-[#6B6F7A] underline hover:text-[#A5A8B0]"
                  >change</button>
                )}
              </div>
            </Field>
          ) : (
            <Field label="Company">
              <input
                ref={firstField}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type a company name…"
                className="w-full rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
              />
              {hits.length > 0 && (
                <ul className="mt-1 divide-y divide-[#1B1E26] rounded border border-[#262A33] bg-[#13151C]">
                  {hits.map(h => (
                    <li key={h.id}>
                      <button
                        onClick={() => { setPicked({ id: h.id, name: h.name }); setHits([]) }}
                        className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-sm text-[#F2F3F5] hover:bg-[#1B1E26]"
                      >
                        <span>{h.name}</span>
                        {h.ticker && <span className="text-[11px] text-[#6B6F7A]">{h.ticker.toUpperCase()}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}

          <Field label="Outcome">
            <Chips options={OUTCOMES} value={outcome} onChange={setOutcome} />
          </Field>

          <Field label="Primary factor">
            <select
              value={factor}
              onChange={e => setFactor(e.target.value as DecisionFactorName)}
              className="w-full rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none"
            >
              {FACTORS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          <Field label="Confidence">
            <Chips
              options={CONFIDENCE}
              value={String(confidence) as (typeof CONFIDENCE)[number]}
              onChange={v => setConfidence(Number(v))}
              numeric
            />
          </Field>

          <Field
            label="Reasoning"
            hint={
              <span className={reasoning.trim().length > 500 ? 'text-[#F87171]' : 'text-[#6B6F7A]'}>
                <span className="tabular-nums">{reasoning.trim().length}</span>/500 · min 10
              </span>
            }
          >
            <textarea
              ref={reasoningField}
              value={reasoning}
              onChange={e => setReasoning(e.target.value)}
              rows={3}
              placeholder="Why this call, in one to three sentences."
              className="w-full resize-none rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm leading-relaxed text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
            />
          </Field>

          <Field label="What would change my mind" hint={<span className="text-[#6B6F7A]">optional</span>}>
            <input
              value={wwcm}
              onChange={e => setWwcm(e.target.value.slice(0, 200))}
              placeholder="The one fact that would flip this."
              className="w-full rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
            />
          </Field>

          <label className="flex items-center gap-2 text-xs text-[#A5A8B0]">
            <input
              type="checkbox"
              checked={dissent}
              onChange={e => setDissent(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#A78BFA]"
            />
            Team disagreed
          </label>

          {error && (
            <p className="rounded border border-[#F87171]/40 bg-[#F87171]/10 px-2.5 py-1.5 text-xs text-[#F87171]">{error}</p>
          )}
          {saved && (
            <p className="rounded border border-[#34D399]/40 bg-[#34D399]/10 px-2.5 py-1.5 text-xs text-[#34D399]">Saved. Refreshing…</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#1B1E26] px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-[#A5A8B0] hover:text-[#F2F3F5]">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={!canSave}
            className="rounded bg-[#A78BFA] px-3 py-1.5 text-xs font-medium text-[#0A0B0F] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >{saving ? 'Saving…' : (submitLabel ?? 'Save decision')}</button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[#6B6F7A]">{label}</span>
        {hint && <span className="text-[10px]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, value, onChange, numeric }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; numeric?: boolean
}) {
  return (
    <div
      role="radiogroup"
      className="flex gap-1.5"
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const i = options.indexOf(value)
        const next = e.key === 'ArrowRight'
          ? (i + 1) % options.length
          : (i - 1 + options.length) % options.length
        onChange(options[next])
      }}
    >
      {options.map(o => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          tabIndex={o === value ? 0 : -1}
          onClick={() => onChange(o)}
          className={[
            'rounded border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]',
            numeric ? 'min-w-[2.25rem] tabular-nums' : '',
            o === value
              ? 'border-[#A78BFA] bg-[#A78BFA]/15 text-[#F2F3F5]'
              : 'border-[#262A33] bg-[#13151C] text-[#A5A8B0] hover:bg-[#1B1E26]',
          ].join(' ')}
        >{o}</button>
      ))}
    </div>
  )
}
