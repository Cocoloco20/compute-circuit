/**
 * Data layer for /pipeline.
 *
 * SERVICE ROLE ONLY — pipeline_cards is RLS-locked with zero policies, so the
 * anon client returns `[]` rather than an error. Never import this from a
 * "use client" component.
 */

import { supabaseServiceRole } from '@/lib/supabase/service-role'
import { PIPELINE_STAGES, STALE_STAGE_DAYS } from '@/lib/terminal-data'
import type { PipelineCard, PipelineStage } from '@/types/db'

export { PIPELINE_STAGES, STALE_STAGE_DAYS }

export interface BoardRow {
  companyId: string
  company: string
  sector: string | null
  stage: PipelineStage
  amountUsd: number | null
  lead: string | null
  owner: string | null
  deadline: string | null
  daysInStage: number
  flag: boolean
  actionNeeded: string | null
}

export interface BoardData {
  rows: BoardRow[]
  counts: Array<{ stage: PipelineStage; count: number }>
  total: number
  error: string | null
}

interface CompanyRow { id: string; name: string; layer_id: string | null }

export async function fetchPipeline(): Promise<BoardData> {
  const sb = supabaseServiceRole()
  const empty: BoardData = {
    rows: [], counts: PIPELINE_STAGES.map(s => ({ stage: s, count: 0 })), total: 0, error: null,
  }

  try {
    const { data, error } = await sb
      .from('pipeline_cards').select('*').order('entered_stage_at', { ascending: true })
    if (error) throw new Error(error.message)
    const cards = (data ?? []) as unknown as PipelineCard[]
    if (!cards.length) return empty

    let names = new Map<string, CompanyRow>()
    try {
      const { data: cos } = await sb
        .from('companies').select('id, name, layer_id').in('id', cards.map(c => c.company_id))
      names = new Map(((cos ?? []) as unknown as CompanyRow[]).map(c => [c.id, c]))
    } catch { /* names are cosmetic — the id is a usable fallback */ }

    const rows: BoardRow[] = cards.map(c => {
      const meta = names.get(c.company_id)
      return {
        companyId: c.company_id,
        company: meta?.name ?? c.company_id,
        sector: meta?.layer_id ?? null,
        stage: c.stage,
        amountUsd: c.amount_usd,
        lead: c.lead,
        owner: c.owner,
        deadline: c.deadline,
        daysInStage: Math.max(0, Math.floor(
          (Date.now() - new Date(c.entered_stage_at).getTime()) / 86_400_000)),
        flag: c.flag,
        actionNeeded: c.action_needed,
      }
    })

    return {
      rows,
      counts: PIPELINE_STAGES.map(stage => ({
        stage, count: rows.filter(r => r.stage === stage).length,
      })),
      total: rows.length,
      error: null,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  }
}
