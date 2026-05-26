import type { SelectedRef } from '@/components/compute-graph'
import type { GraphData } from './graph-data'

export interface ContextRelation {
  ref: SelectedRef                  // {kind, id} that drawer accepts
  label: string                     // visible name
  relation: string                  // 'invests in' | 'invested by' | 'supplies' | 'gated by' | 'in layer' | etc.
  strength?: number                 // optional 0-1 for ordering
}

/**
 * Deduplicates relations by ref kind + id, keeping the one with higher strength,
 * sorts by strength descending, and caps at 30 results.
 */
function deduplicateAndLimit(relations: ContextRelation[]): ContextRelation[] {
  const seen = new Map<string, ContextRelation>()
  for (const rel of relations) {
    const key = `${rel.ref.kind}:${rel.ref.id}`
    const existing = seen.get(key)
    if (!existing || (rel.strength ?? 0) > (existing.strength ?? 0)) {
      seen.set(key, rel)
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, 30)
}

export function deriveContextForCompany(id: string, data: GraphData): ContextRelation[] {
  const company = data.companies.find(c => c.id === id)
  if (!company) return []

  const relations: ContextRelation[] = []

  // 1. Layers it sits in (via data.companies[].layer_id -> data.layers)
  if (company.layer_id) {
    const layer = data.layers.find(l => l.id === company.layer_id)
    if (layer) {
      relations.push({
        ref: { kind: 'layer', id: layer.id },
        label: layer.name,
        relation: 'in layer',
        strength: 0.8,
      })
    }
  }

  // 2. Backers (data.backers where company_id = id -> data.investors)
  const myBackerIds = new Set<string>()
  data.backers.forEach(b => {
    if (b.company_id === id) {
      myBackerIds.add(b.investor_id)
      const inv = data.investors.find(i => i.id === b.investor_id)
      if (inv) {
        relations.push({
          ref: { kind: 'investor', id: inv.id },
          label: inv.name,
          relation: 'invested by',
          strength: 0.9,
        })
      }
    }
  })

  // 3. Portfolio cos for the same backers (1-hop investor neighbors)
  if (myBackerIds.size > 0) {
    data.backers.forEach(b => {
      if (myBackerIds.has(b.investor_id) && b.company_id !== id) {
        const peer = data.companies.find(c => c.id === b.company_id)
        if (peer) {
          relations.push({
            ref: { kind: 'company', id: peer.id },
            label: peer.name,
            relation: 'backer portfolio mate',
            strength: 0.5,
          })
        }
      }
    })
  }

  // 4. Bottlenecks it benefits from (data.bottleneckBeneficiaries)
  data.bottleneckBeneficiaries.forEach(bb => {
    if (bb.company_id === id) {
      const bn = data.bottlenecks.find(b => b.id === bb.bottleneck_id)
      if (bn) {
        // High severity bottlenecks have more strength
        let strength = 0.7
        if (bn.severity === 'critical') strength = 0.75
        if (bn.severity === 'high') strength = 0.73
        relations.push({
          ref: { kind: 'bottleneck', id: bn.id },
          label: bn.name,
          relation: 'benefits from',
          strength,
        })
      }
    }
  })

  // 5. Country (so agencies in same country show up)
  if (company.country) {
    const countryAgencies = (data.agencies ?? []).filter(a => a.jurisdiction === company.country)
    countryAgencies.forEach(ag => {
      relations.push({
        ref: { kind: 'agency', id: ag.id },
        label: ag.name,
        relation: 'jurisdiction agency',
        strength: 0.4,
      })
    })
  }

  return deduplicateAndLimit(relations)
}

export function deriveContextForAgency(id: string, data: GraphData): ContextRelation[] {
  const agency = (data.agencies ?? []).find(a => a.id === id)
  if (!agency) return []

  const relations: ContextRelation[] = []

  // 1. Layer it regulates/associated with
  if (agency.layer_id) {
    const layer = data.layers.find(l => l.id === agency.layer_id)
    if (layer) {
      relations.push({
        ref: { kind: 'layer', id: layer.id },
        label: layer.name,
        relation: 'associated layer',
        strength: 0.8,
      })
    }
  }

  // 2. Companies in the same country/jurisdiction
  if (agency.jurisdiction) {
    data.companies.forEach(c => {
      if (c.country === agency.jurisdiction) {
        relations.push({
          ref: { kind: 'company', id: c.id },
          label: c.name,
          relation: 'regulated company',
          strength: 0.7,
        })
      }
    })
  }

  // 3. Other agencies in the same country/jurisdiction
  if (agency.jurisdiction) {
    (data.agencies ?? []).forEach(a => {
      if (a.jurisdiction === agency.jurisdiction && a.id !== id) {
        relations.push({
          ref: { kind: 'agency', id: a.id },
          label: a.name,
          relation: 'peer agency',
          strength: 0.6,
        })
      }
    })
  }

  return deduplicateAndLimit(relations)
}

export function deriveContextForBottleneck(id: string, data: GraphData): ContextRelation[] {
  const bottleneck = data.bottlenecks.find(b => b.id === id)
  if (!bottleneck) return []

  const relations: ContextRelation[] = []

  // 1. Beneficiary companies
  data.bottleneckBeneficiaries.forEach(bb => {
    if (bb.bottleneck_id === id) {
      const c = data.companies.find(co => co.id === bb.company_id)
      if (c) {
        relations.push({
          ref: { kind: 'company', id: c.id },
          label: c.name,
          relation: 'beneficiary company',
          strength: 0.9,
        })
      }
    }
  })

  // 2. Layers it is between
  if (bottleneck.between_above) {
    const layerAbove = data.layers.find(l => l.id === bottleneck.between_above)
    if (layerAbove) {
      relations.push({
        ref: { kind: 'layer', id: layerAbove.id },
        label: layerAbove.name,
        relation: 'gates layer above',
        strength: 0.8,
      })
    }
  }

  if (bottleneck.between_below) {
    const layerBelow = data.layers.find(l => l.id === bottleneck.between_below)
    if (layerBelow) {
      relations.push({
        ref: { kind: 'layer', id: layerBelow.id },
        label: layerBelow.name,
        relation: 'gates layer below',
        strength: 0.8,
      })
    }
  }

  // 3. Layer it is directly in
  if (bottleneck.layer_id) {
    const layer = data.layers.find(l => l.id === bottleneck.layer_id)
    if (layer) {
      relations.push({
        ref: { kind: 'layer', id: layer.id },
        label: layer.name,
        relation: 'in layer',
        strength: 0.7,
      })
    }
  }

  return deduplicateAndLimit(relations)
}
