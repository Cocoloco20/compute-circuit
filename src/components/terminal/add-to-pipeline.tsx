'use client'

/**
 * One-click sourcing from /screen.
 *
 * Always enters at Sourcing. The API rejects creating a card directly at
 * Passed, Term Sheet or Closed, because that would be a way to record a
 * decision without recording why — the same gate the pipeline enforces.
 */

import { useState } from 'react'
import { getClientKey } from '@/lib/watchlist-store'

export default function AddToPipeline({ companyId, name, already }: {
  companyId: string; name: string; already: boolean
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>(
    already ? 'done' : 'idle')
  const [msg, setMsg] = useState<string | null>(null)

  if (state === 'done') {
    return <span className="whitespace-nowrap text-[11px] text-[#34D399]">in pipeline</span>
  }

  async function add() {
    const key = getClientKey()
    if (!key) { setState('error'); setMsg('key required'); return }
    setState('saving')
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ company_id: companyId, stage: 'Sourcing' }),
      })
      if (res.status === 401) {
        window.localStorage.removeItem('cc_key')
        setState('error'); setMsg('key rejected'); return
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setState('error'); setMsg(body?.error?.slice(0, 40) ?? 'failed'); return }
      setState('done')
    } catch {
      setState('error'); setMsg('network')
    }
  }

  return (
    <button
      onClick={() => void add()}
      disabled={state === 'saving'}
      title={`Add ${name} to Sourcing`}
      className="whitespace-nowrap rounded border border-[#3A3F4B] bg-[#13151C] px-2 py-1 text-[11px] text-[#F2F3F5] transition-colors hover:bg-[#1B1E26] disabled:opacity-40"
    >
      {state === 'saving' ? 'adding…' : state === 'error' ? (msg ?? 'retry') : '+ pipeline'}
    </button>
  )
}
