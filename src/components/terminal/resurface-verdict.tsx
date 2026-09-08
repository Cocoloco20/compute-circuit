'use client'

/**
 * One-click verdict on a resurfaced decision.
 *
 * The whole point of resurfacing is that judging it has to be nearly free —
 * three buttons, no modal, no navigation. If it costs more than a click the
 * cards pile up unjudged and the calibration data never accumulates.
 */

import { useState } from 'react'
import { getClientKey } from '@/lib/watchlist-store'
import type { ResurfaceVerdict } from '@/types/db'

const VERDICTS: ResurfaceVerdict[] = ['Yes', 'Partially', 'No']

export default function ResurfaceVerdictButtons({ resurfacingId }: { resurfacingId: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [picked, setPicked] = useState<ResurfaceVerdict | null>(null)

  async function send(v: ResurfaceVerdict) {
    const key = getClientKey()
    if (!key) { setState('error'); return }
    setPicked(v); setState('saving')
    try {
      const res = await fetch('/api/decisions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ resurfacing_id: resurfacingId, verdict: v }),
      })
      if (!res.ok) { setState('error'); return }
      setState('done')
      setTimeout(() => window.location.reload(), 500)
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return <p className="text-xs text-[#34D399]">Recorded: {picked}</p>
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-xs text-[#6B6F7A]">Was the reasoning right?</span>
      {VERDICTS.map(v => (
        <button
          key={v}
          onClick={() => void send(v)}
          disabled={state === 'saving'}
          className="rounded border border-[#262A33] bg-[#13151C] px-2 py-0.5 text-xs text-[#A5A8B0] transition-colors hover:bg-[#1B1E26] hover:text-[#F2F3F5] disabled:opacity-40"
        >{v}</button>
      ))}
      {state === 'error' && <span className="text-xs text-[#F87171]">Couldn&apos;t save.</span>}
    </div>
  )
}
