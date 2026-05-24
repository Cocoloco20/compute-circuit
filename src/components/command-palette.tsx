'use client'

/**
 * Cmd/Ctrl+K fuzzy search across companies, investors, and bottlenecks.
 * Pure client-side filtering — the graph is small enough that we don't need
 * a real index. Keyboard nav: ↑/↓ to move, Enter to open, Esc to close.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData } from '@/lib/graph-data'
import type { SelectedRef } from './compute-graph'

type Hit = SelectedRef & {
  label: string
  sub: string | null
}

interface Props {
  data: GraphData
  onClose: () => void
  onSelect: (sel: SelectedRef) => void
}

export default function CommandPalette({ data, onClose, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build search corpus once per data prop.
  const corpus = useMemo<Hit[]>(() => {
    const c: Hit[] = []
    for (const co of data.companies) {
      c.push({ kind: 'company', id: co.id, label: co.name, sub: co.ticker ?? co.layer_id ?? null })
    }
    for (const inv of data.investors) {
      c.push({ kind: 'investor', id: inv.id, label: inv.name, sub: 'investor' })
    }
    for (const b of data.bottlenecks) {
      c.push({ kind: 'bottleneck', id: b.id, label: b.name, sub: b.severity ?? 'bottleneck' })
    }
    return c
  }, [data])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return corpus.slice(0, 20)
    return corpus
      .filter(h => h.label.toLowerCase().includes(needle) || h.id.includes(needle) || (h.sub ?? '').toLowerCase().includes(needle))
      .slice(0, 20)
  }, [corpus, q])

  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => { inputRef.current?.focus() }, [])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[idx]
      if (hit) onSelect({ kind: hit.kind, id: hit.id } as SelectedRef)
    }
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 pt-32 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[520px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search companies, investors, bottlenecks…"
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="max-h-[360px] overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">no matches</div>
          )}
          {results.map((hit, i) => {
            const active = i === idx
            return (
              <button
                type="button"
                key={`${hit.kind}-${hit.id}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onSelect({ kind: hit.kind, id: hit.id } as SelectedRef)}
                className={
                  'flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ' +
                  (active ? 'bg-zinc-800/80 text-white' : 'text-zinc-300 hover:bg-zinc-900')
                }
              >
                <div>
                  <span>{hit.label}</span>
                  {hit.sub && <span className="ml-2 text-xs text-zinc-500">{hit.sub}</span>}
                </div>
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">{hit.kind}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-[10px] uppercase tracking-widest text-zinc-600">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{results.length} of {corpus.length}</span>
        </div>
      </div>
    </div>
  )
}
