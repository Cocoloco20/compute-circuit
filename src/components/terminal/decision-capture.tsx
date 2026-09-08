'use client'

/**
 * Ad-hoc Decision Capture — the `d`-from-anywhere path.
 *
 * The other path is a stage change in the pipeline, which forces the same
 * form via DecisionForm. This one exists for decisions that don't correspond
 * to a card move: a call you took, a founder you met, a name you looked at
 * once and rejected before it ever entered the funnel. Those are exactly the
 * decisions that otherwise leave no trace.
 */

import { useEffect, useState } from 'react'
import DecisionForm, { type DecisionPayload } from '@/components/terminal/decision-form'
import { getClientKey } from '@/lib/watchlist-store'

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

  async function submit(company: { id: string; name: string }, payload: DecisionPayload) {
    const key = getClientKey()
    if (!key) return 'A CRON_SECRET is required to write decisions.'
    try {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ company_id: company.id, ...payload }),
      })
      if (res.status === 401) {
        window.localStorage.removeItem('cc_key')
        return 'Key rejected — try again.'
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return body?.error ?? 'Save failed.'
      return null
    } catch {
      return 'Network error — decision not saved.'
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-[#3A3F4B] bg-[#13151C] px-3 py-1.5 text-xs font-medium text-[#F2F3F5] transition-colors hover:bg-[#1B1E26] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA]"
      >
        Capture decision <kbd className="ml-1.5 text-[10px] text-[#6B6F7A]">d</kbd>
      </button>
      {open && (
        <DecisionForm
          title="Decision"
          company={presetCompany ?? null}
          lockCompany={!!presetCompany}
          onClose={() => setOpen(false)}
          onSubmit={submit}
        />
      )}
    </>
  )
}
