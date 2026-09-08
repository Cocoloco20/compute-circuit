'use client'

/**
 * Decision Capture — the reason this product exists.
 *
 * Every pass, advance and invest gets its reasoning recorded at the moment
 * the call is made, not reconstructed months later when a passed company
 * raises a Series A and nobody remembers why we said no. Structured fields,
 * not free text, so the reasoning is queryable: "every pass where the primary
 * factor was Market Timing and confidence was 5" is the calibration set.
 *
 * Keyboard-first, zero mouse required: Tab across the chips, arrows to pick,
 * ⌘/Ctrl+Enter to submit, Esc to cancel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/client'
import { getClientKey } from '@/lib/watchlist-store'
import type { DecisionOutcome, DecisionFactorName } from '@/types/db'

const OUTCOMES: DecisionOutcome[] = ['Pass', 'Advance', 'Invest']
const FACTORS: DecisionFactorName[] = [
  'Market Timing', 'Team', 'Product', 'Competition',
  'Traction', 'Valuation', 'Thesis Fit', 'Other',
]
const CONFIDENCE = [1, 2, 3, 4, 5] as const

interface CompanyHit { id: string; name: string; ticker: string | null }

export default function DecisionCapture({ presetCompany }: {
  presetCompany?: { id: string; name: string }
}) {
  const [open, setOpen] = useState(false)

  // `d` opens capture from anywhere, unless the user is mid-typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'd' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-[#3A3F4B] bg-[#13151C] px-3 py-1.5 text-xs font-medium text-[#F2F3F5] transition-colors hover:bg-[#1B1E26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]"
      >
        Capture decision <kbd className="ml-1.5 text-[10px] text-[#6B6F7A]">d</kbd>
      </button>
      {open && <Modal onClose={() => setOpen(false)} presetCompany={presetCompany} />}
    </>
  )
}

function Modal({ onClose, presetCompany }: {
  onClose: () => void
  presetCompany?: { id: string; name: string }
}) {
  const [company, setCompany] = useState<{ id: string; name: string } | null>(presetCompany ?? null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CompanyHit[]>([])
  const [outcome, setOutcome] = useState<DecisionOutcome>('Pass')
  const [factor, setFactor] = useState<DecisionFactorName>('Market Timing')
  const [confidence, setConfidence] = useState<number>(3)
  const [reasoning, setReasoning] = useState('')
  const [wwcm, setWwcm] = useState('')
  const [dissent, setDissent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => { firstField.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Company lookup runs against the anon client: `companies` is public data
  // (it's already in the graph's SSR payload). The decision itself goes
  // through the authenticated route — those tables the anon key cannot see.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || company) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser()
        .from('companies').select('id, name, ticker')
        .ilike('name', `%${q}%`).limit(6)
      if (!cancelled) setHits((data ?? []) as CompanyHit[])
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, company])

  const reasoningOk = reasoning.trim().length >= 10 && reasoning.trim().length <= 500
  const canSave = !!company && reasoningOk && !saving

  const submit = useCallback(async () => {
    if (!company || !reasoningOk) return
    const key = getClientKey()
    if (!key) { setError('A CRON_SECRET is required to write decisions.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          company_id: company.id,
          outcome,
          primary_factor: factor,
          confidence,
          reasoning: reasoning.trim(),
          what_would_change_mind: wwcm.trim() || undefined,
          dissent,
        }),
      })
      if (res.status === 401) {
        window.localStorage.removeItem('cc_key')
        setError('Key rejected — try again.')
        return
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body?.error ?? 'Save failed.'); return }
      setSaved(true)
      // Reload so the commit log and queue reflect the new row.
      setTimeout(() => window.location.reload(), 600)
    } catch {
      setError('Network error — decision not saved.')
    } finally {
      setSaving(false)
    }
  }, [company, outcome, factor, confidence, reasoning, wwcm, dissent, reasoningOk])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Capture decision"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit() }
        }}
        className="w-full max-w-lg rounded-lg border border-[#262A33] bg-[#0A0B0F] shadow-2xl"
      >
        <header className="flex items-baseline justify-between border-b border-[#1B1E26] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#F2F3F5]">
            Decision{company ? `: ${company.name}` : ''}
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-[#6B6F7A]">
            ⌘↵ save · esc cancel
          </span>
        </header>

        <div className="space-y-4 p-4">
          {/* Company ------------------------------------------------------ */}
          {company ? (
            <Field label="Company">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#F2F3F5]">{company.name}</span>
                {!presetCompany && (
                  <button
                    onClick={() => { setCompany(null); setQuery('') }}
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
                        onClick={() => { setCompany({ id: h.id, name: h.name }); setHits([]) }}
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

          {/* Outcome ------------------------------------------------------ */}
          <Field label="Outcome">
            <Chips options={OUTCOMES} value={outcome} onChange={setOutcome} />
          </Field>

          {/* Primary factor ----------------------------------------------- */}
          <Field label="Primary factor">
            <select
              value={factor}
              onChange={e => setFactor(e.target.value as DecisionFactorName)}
              className="w-full rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm text-[#F2F3F5] focus:border-[#A78BFA] focus:outline-none"
            >
              {FACTORS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          {/* Confidence --------------------------------------------------- */}
          <Field label="Confidence">
            <Chips
              options={CONFIDENCE.map(String)}
              value={String(confidence)}
              onChange={v => setConfidence(Number(v))}
              numeric
            />
          </Field>

          {/* Reasoning ---------------------------------------------------- */}
          <Field
            label="Reasoning"
            hint={
              <span className={reasoning.length > 500 ? 'text-[#F87171]' : 'text-[#6B6F7A]'}>
                <span className="tabular-nums">{reasoning.trim().length}</span>/500 · min 10
              </span>
            }
          >
            <textarea
              value={reasoning}
              onChange={e => setReasoning(e.target.value)}
              rows={3}
              placeholder="Why this call, in one to three sentences."
              className="w-full resize-none rounded border border-[#262A33] bg-[#13151C] px-2.5 py-1.5 text-sm leading-relaxed text-[#F2F3F5] placeholder:text-[#43474F] focus:border-[#A78BFA] focus:outline-none"
            />
          </Field>

          {/* What would change my mind ------------------------------------ */}
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
            <p className="rounded border border-[#F87171]/40 bg-[#F87171]/10 px-2.5 py-1.5 text-xs text-[#F87171]">
              {error}
            </p>
          )}
          {saved && (
            <p className="rounded border border-[#34D399]/40 bg-[#34D399]/10 px-2.5 py-1.5 text-xs text-[#34D399]">
              Saved. Refreshing…
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#1B1E26] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-[#A5A8B0] hover:text-[#F2F3F5]"
          >Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={!canSave}
            className="rounded bg-[#A78BFA] px-3 py-1.5 text-xs font-medium text-[#0A0B0F] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >{saving ? 'Saving…' : 'Save decision'}</button>
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
            numeric ? 'tabular-nums min-w-[2.25rem]' : '',
            o === value
              ? 'border-[#A78BFA] bg-[#A78BFA]/15 text-[#F2F3F5]'
              : 'border-[#262A33] bg-[#13151C] text-[#A5A8B0] hover:bg-[#1B1E26]',
          ].join(' ')}
        >{o}</button>
      ))}
    </div>
  )
}
