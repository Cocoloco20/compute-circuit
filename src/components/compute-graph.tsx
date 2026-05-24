'use client'

/**
 * 3D knowledge-graph viewer for the AI compute ecosystem.
 *
 * Scene structure (all built once in useEffect):
 *   - Faint horizontal "ring" lines marking each layer's y_position
 *   - Company nodes: spheres with Clearbit logo textures, sized by weight,
 *     placed on a circle of radius R around their layer's y
 *   - Investor nodes: same sprite style, floating above the labs layer
 *   - Bottleneck nodes: glowing octahedra positioned between their two layers
 *   - Flow edges: cubic Bezier curves with 3–6 traveling particles each,
 *     color-coded by flow type. Particle phase animated via requestAnimationFrame.
 *
 * Interaction:
 *   - OrbitControls (left-drag orbit, right-drag pan, scroll zoom)
 *   - Click a node → opens entity drawer on the right
 *   - Cmd/Ctrl+K → command palette
 *   - Click an investor chip in the left rail → filter graph to its portfolio
 *   - Esc closes everything
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Company, Flow, FlowType, NodeKind } from '@/types/db'
import type { GraphData } from '@/lib/graph-data'
import EntityDrawer from './entity-drawer'
import CommandPalette from './command-palette'

// ---------- visual constants ----------

const FLOW_COLORS: Record<FlowType, number> = {
  money:     0x10b981, // emerald
  compute:   0x22d3ee, // cyan
  energy:    0xfbbf24, // amber
  equipment: 0xcbd5e1, // slate-300
  intel:     0xa855f7, // purple
  venture:   0xec4899, // pink
}

const FLOW_LABELS: Record<FlowType, string> = {
  money: 'money',
  compute: 'compute',
  energy: 'energy',
  equipment: 'equipment',
  intel: 'intel',
  venture: 'venture',
}

const LAYER_RING_RADIUS = 9      // companies sit on this circle around each layer's y
const INVESTOR_RING_RADIUS = 14  // investors float on a wider ring above labs
const INVESTOR_Y = 13            // above the top layer (labs is y=10)
const BG_COLOR = 0x05060a

// ---------- types ----------

export type SelectedRef =
  | { kind: 'company'; id: string }
  | { kind: 'investor'; id: string }
  | { kind: 'bottleneck'; id: string }

interface NodePosition {
  x: number
  y: number
  z: number
}
interface FlowAnim {
  particles: THREE.Mesh[]
  curve: THREE.CubicBezierCurve3
  speed: number
  flow: Flow
}

// ---------- helpers ----------

function logoUrl(domain: string | null | undefined): string | null {
  if (!domain) return null
  return `https://logo.clearbit.com/${domain}?size=128`
}

// Place N items evenly around a circle at given y, with optional angle offset
// so different layers don't all stack their nodes at the same angles.
function ringPosition(index: number, total: number, radius: number, y: number, offset = 0): NodePosition {
  const theta = (index / Math.max(total, 1)) * Math.PI * 2 + offset
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius }
}

function computePositions(data: GraphData) {
  const companyPos = new Map<string, NodePosition>()
  const investorPos = new Map<string, NodePosition>()
  const bottleneckPos = new Map<string, NodePosition>()

  // Group companies by layer; sort by id so positions are stable across renders.
  const byLayer = new Map<string, Company[]>()
  for (const c of data.companies) {
    const key = c.layer_id ?? '_unknown'
    if (!byLayer.has(key)) byLayer.set(key, [])
    byLayer.get(key)!.push(c)
  }
  for (const arr of byLayer.values()) arr.sort((a, b) => a.id.localeCompare(b.id))

  const layerMap = new Map(data.layers.map(l => [l.id, l]))
  byLayer.forEach((arr, layerId) => {
    const layer = layerMap.get(layerId)
    const y = layer?.y_position ?? 0
    // small per-layer angular offset breaks vertical alignment between layers
    const offset = (layer?.order_index ?? 0) * 0.31
    arr.forEach((c, i) => companyPos.set(c.id, ringPosition(i, arr.length, LAYER_RING_RADIUS, y, offset)))
  })

  data.investors.forEach((inv, i) =>
    investorPos.set(inv.id, ringPosition(i, data.investors.length, INVESTOR_RING_RADIUS, INVESTOR_Y, 0.15)),
  )

  // Bottlenecks: place between their two layers, at a fixed angular slot, slightly off-center
  // so they don't sit on top of a company.
  data.bottlenecks.forEach((b, i) => {
    const above = b.between_above ? layerMap.get(b.between_above)?.y_position : null
    const below = b.between_below ? layerMap.get(b.between_below)?.y_position : null
    const y =
      above != null && below != null
        ? (above + below) / 2
        : layerMap.get(b.layer_id ?? '')?.y_position ?? 0
    const angle = (i / Math.max(data.bottlenecks.length, 1)) * Math.PI * 2 + Math.PI / 7
    bottleneckPos.set(b.id, {
      x: Math.cos(angle) * (LAYER_RING_RADIUS * 0.55),
      y,
      z: Math.sin(angle) * (LAYER_RING_RADIUS * 0.55),
    })
  })

  return { companyPos, investorPos, bottleneckPos }
}

// Disposes all materials/geometries/textures attached to a mesh tree.
// Three.js typing for Object3D doesn't surface `geometry`/`material` (those
// only exist on Mesh/Line/Sprite subtypes), so we narrow with hand-written shapes.
type Disposable = { dispose: () => void }
type DisposableMaterial = THREE.Material & { map?: THREE.Texture | null }
type DisposableObject = THREE.Object3D & {
  geometry?: Disposable
  material?: DisposableMaterial | DisposableMaterial[]
}
function disposeMesh(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const c = child as DisposableObject
    c.geometry?.dispose()
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      mats.forEach((m) => {
        m.map?.dispose()
        m.dispose()
      })
    }
  })
}

// ---------- main component ----------

export default function ComputeGraph({ data }: { data: GraphData }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<SelectedRef | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [backerFilter, setBackerFilter] = useState<string | null>(null) // investor id
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null)

  const positions = useMemo(() => computePositions(data), [data])

  // Backer filter set — which companies + investors are highlighted
  const filterSet = useMemo(() => {
    if (!backerFilter) return null
    const companies = new Set(
      data.backers.filter(b => b.investor_id === backerFilter).map(b => b.company_id),
    )
    return { companies, investors: new Set([backerFilter]) }
  }, [backerFilter, data.backers])

  // ---------- main THREE setup ----------

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ----- scene + camera + renderer -----
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BG_COLOR)
    scene.fog = new THREE.Fog(BG_COLOR, 30, 80)

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 200)
    camera.position.set(22, 4, 22)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 8
    controls.maxDistance = 80
    controls.target.set(0, 2, 0)

    // ----- lighting -----
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(15, 25, 15)
    scene.add(dir)
    const rim = new THREE.PointLight(0x4f46e5, 0.4, 60)
    rim.position.set(-15, 5, -15)
    scene.add(rim)

    // ----- layer rings -----
    const ringMaterial = new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.6 })
    const layerGroup = new THREE.Group()
    data.layers.forEach((layer) => {
      const pts: THREE.Vector3[] = []
      const segments = 64
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(t) * LAYER_RING_RADIUS, layer.y_position, Math.sin(t) * LAYER_RING_RADIUS))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.LineLoop(geo, ringMaterial)
      layerGroup.add(line)
    })
    scene.add(layerGroup)

    // ----- nodes -----
    const nodeMeshes: THREE.Mesh[] = []
    const textureLoader = new THREE.TextureLoader()
    textureLoader.setCrossOrigin('anonymous')

    function makeNode(opts: {
      id: string
      kind: NodeKind | 'bottleneck'
      pos: NodePosition
      radius: number
      domain: string | null
      color: number
      label: string
    }): THREE.Mesh {
      const geo = new THREE.SphereGeometry(opts.radius, 24, 24)
      // Start with flat color; if logo loads we swap to a textured material
      const mat = new THREE.MeshStandardMaterial({
        color: opts.color,
        metalness: 0.15,
        roughness: 0.55,
        emissive: opts.color,
        emissiveIntensity: 0.18,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(opts.pos.x, opts.pos.y, opts.pos.z)
      mesh.userData = { kind: opts.kind, id: opts.id, label: opts.label }

      const url = logoUrl(opts.domain)
      if (url) {
        textureLoader.load(
          url,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace
            mat.map = tex
            // Soften emissive since the logo provides the color
            mat.color.setHex(0xffffff)
            mat.emissiveIntensity = 0.08
            mat.needsUpdate = true
          },
          undefined,
          () => { /* swallow — keep flat color */ },
        )
      }
      return mesh
    }

    // Helper to dim nodes/flows that don't match the active backer filter.
    function applyFilterToMaterial(mat: THREE.MeshStandardMaterial, matches: boolean) {
      if (!filterSet) return
      mat.transparent = true
      mat.opacity = matches ? 1 : 0.18
    }

    // Companies
    data.companies.forEach((c) => {
      const pos = positions.companyPos.get(c.id)
      if (!pos) return
      const radius = 0.35 + Math.min(c.weight, 10) * 0.06
      const color = c.private ? 0x60a5fa : c.position_held ? 0xfbbf24 : 0x94a3b8
      const node = makeNode({
        id: c.id, kind: 'company', pos, radius, domain: c.domain, color,
        label: `${c.name}${c.ticker ? ` · ${c.ticker}` : ''}`,
      })
      applyFilterToMaterial(node.material as THREE.MeshStandardMaterial, !filterSet || filterSet.companies.has(c.id))
      scene.add(node)
      nodeMeshes.push(node)
    })

    // Investors
    data.investors.forEach((inv) => {
      const pos = positions.investorPos.get(inv.id)
      if (!pos) return
      const node = makeNode({
        id: inv.id, kind: 'investor', pos, radius: 0.5, domain: inv.domain, color: 0xc084fc,
        label: inv.name,
      })
      applyFilterToMaterial(node.material as THREE.MeshStandardMaterial, !filterSet || filterSet.investors.has(inv.id))
      scene.add(node)
      nodeMeshes.push(node)
    })

    // Bottlenecks — octahedron, glowing
    const bottleneckMeshes: THREE.Mesh[] = []
    data.bottlenecks.forEach((b) => {
      const pos = positions.bottleneckPos.get(b.id)
      if (!pos) return
      const geo = new THREE.OctahedronGeometry(0.55, 0)
      const sevColor =
        b.severity === 'critical' ? 0xef4444 :
        b.severity === 'high' ? 0xf97316 :
        b.severity === 'medium' ? 0xfbbf24 : 0x94a3b8
      const mat = new THREE.MeshStandardMaterial({
        color: sevColor, emissive: sevColor, emissiveIntensity: 0.7,
        metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.92,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(pos.x, pos.y, pos.z)
      mesh.userData = { kind: 'bottleneck', id: b.id, label: b.name }
      scene.add(mesh)
      nodeMeshes.push(mesh)
      bottleneckMeshes.push(mesh)
    })

    // ----- flows: curves + particles -----
    const flowAnims: FlowAnim[] = []
    const flowGroup = new THREE.Group()

    function nodePos(id: string, kind: NodeKind): NodePosition | undefined {
      return kind === 'company' ? positions.companyPos.get(id) : positions.investorPos.get(id)
    }

    data.flows.forEach((flow) => {
      const from = nodePos(flow.from_id, flow.from_kind)
      const to = nodePos(flow.to_id, flow.to_kind)
      if (!from || !to) return

      const start = new THREE.Vector3(from.x, from.y, from.z)
      const end = new THREE.Vector3(to.x, to.y, to.z)
      // Two control points lifted off the layer axis so curves bow outward
      // (avoids straight-line tunneling through the center column).
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      const dist = start.distanceTo(end)
      const outward = mid.clone().setY(0).normalize().multiplyScalar(dist * 0.18)
      const c1 = new THREE.Vector3().lerpVectors(start, end, 0.33).add(outward).setY(start.y + (end.y - start.y) * 0.33)
      const c2 = new THREE.Vector3().lerpVectors(start, end, 0.66).add(outward).setY(start.y + (end.y - start.y) * 0.66)
      const curve = new THREE.CubicBezierCurve3(start, c1, c2, end)

      // When a backer filter is active, dim flows that don't connect to a matching node.
      const flowMatches = !filterSet || (
        ((flow.from_kind === 'company' && filterSet.companies.has(flow.from_id)) ||
         (flow.from_kind === 'investor' && filterSet.investors.has(flow.from_id))) ||
        ((flow.to_kind === 'company' && filterSet.companies.has(flow.to_id)) ||
         (flow.to_kind === 'investor' && filterSet.investors.has(flow.to_id)))
      )

      const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.015, 6, false)
      const lineMat = new THREE.MeshBasicMaterial({
        color: FLOW_COLORS[flow.type], transparent: true, opacity: flowMatches ? 0.22 : 0.04,
      })
      const tube = new THREE.Mesh(tubeGeo, lineMat)
      tube.userData = { flowId: flow.id, type: flow.type, from: flow.from_id, to: flow.to_id }
      flowGroup.add(tube)

      // Particles travel along the curve. Count scales with magnitude (1–10).
      const particleCount = Math.max(2, Math.min(6, Math.round(flow.magnitude / 2)))
      const pGeo = new THREE.SphereGeometry(0.07, 8, 8)
      const pMat = new THREE.MeshBasicMaterial({
        color: FLOW_COLORS[flow.type],
        transparent: true,
        opacity: flowMatches ? 1 : 0.15,
      })
      const particles: THREE.Mesh[] = []
      for (let i = 0; i < particleCount; i++) {
        const p = new THREE.Mesh(pGeo, pMat)
        p.userData = { flowId: flow.id }
        flowGroup.add(p)
        particles.push(p)
      }
      flowAnims.push({
        particles,
        curve,
        speed: 0.05 + flow.magnitude * 0.015,
        flow,
      })
    })
    scene.add(flowGroup)

    // ----- raycasting (click + hover) -----
    const raycaster = new THREE.Raycaster()
    const mouseNDC = new THREE.Vector2()

    function pickAt(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouseNDC, camera)
      const hits = raycaster.intersectObjects(nodeMeshes, false)
      return hits[0]?.object as THREE.Mesh | undefined
    }

    function onClick(e: MouseEvent) {
      const hit = pickAt(e.clientX, e.clientY)
      if (hit) setSelected({ kind: hit.userData.kind, id: hit.userData.id })
    }

    function onPointerMove(e: PointerEvent) {
      const hit = pickAt(e.clientX, e.clientY)
      if (hit) {
        setHover({ label: hit.userData.label, x: e.clientX, y: e.clientY })
        renderer.domElement.style.cursor = 'pointer'
      } else {
        setHover(null)
        renderer.domElement.style.cursor = 'grab'
      }
    }
    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('pointermove', onPointerMove)

    // ----- animation loop -----
    let raf = 0
    const t0 = performance.now()
    function tick() {
      const t = (performance.now() - t0) * 0.001
      controls.update()
      // Slowly rotate bottlenecks for a "live" feel
      bottleneckMeshes.forEach((m) => { m.rotation.y = t * 0.6; m.rotation.x = t * 0.4 })
      // Move particles along their flows
      flowAnims.forEach(({ particles, curve, speed }) => {
        particles.forEach((p, i) => {
          let offset = (t * speed + i / particles.length) % 1
          if (offset < 0) offset += 1
          const point = curve.getPoint(offset)
          p.position.copy(point)
        })
      })
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    // ----- resize -----
    function onResize() {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)

    // ----- cleanup -----
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      controls.dispose()
      scene.traverse(disposeMesh)
      ringMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [data, positions, filterSet])

  // ---------- key bindings ----------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false)
        else if (selected) setSelected(null)
        else if (backerFilter) setBackerFilter(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, selected, backerFilter])

  // ---------- render UI overlay ----------

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#05060a] text-zinc-200">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
        <div className="pointer-events-auto font-mono text-sm">
          <span className="font-semibold text-white">Compute Circuit</span>
          <span className="ml-3 text-zinc-500">
            {data.companies.length} cos · {data.investors.length} investors · {data.flows.length} flows · {data.bottlenecks.length} bottlenecks
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="pointer-events-auto rounded border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur hover:border-zinc-700 hover:text-white"
        >
          ⌘K Search
        </button>
      </div>

      {/* Layer key — left rail (top) */}
      <div className="pointer-events-auto absolute left-4 top-16 z-10 w-44 space-y-0.5 text-[11px] font-mono text-zinc-500">
        <div className="mb-1 text-zinc-600 uppercase tracking-wider">Layers</div>
        {[...data.layers].reverse().map((l) => (
          <div key={l.id} className="flex items-center justify-between">
            <span>{l.name}</span>
            <span className="text-zinc-700">{data.companies.filter(c => c.layer_id === l.id).length}</span>
          </div>
        ))}
      </div>

      {/* Backer filter chips — left rail (bottom) */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-10 max-w-[200px] space-y-1 text-[11px] font-mono">
        <div className="mb-1 text-zinc-600 uppercase tracking-wider">Filter by backer</div>
        {data.investors.map((inv) => {
          const active = backerFilter === inv.id
          return (
            <button
              type="button"
              key={inv.id}
              onClick={() => setBackerFilter(active ? null : inv.id)}
              className={
                'block w-full rounded border px-2 py-1 text-left transition-colors ' +
                (active
                  ? 'border-purple-500/60 bg-purple-500/10 text-purple-200'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200')
              }
            >
              {inv.name}
            </button>
          )
        })}
        {backerFilter && (
          <button
            type="button"
            onClick={() => setBackerFilter(null)}
            className="block w-full rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-center text-zinc-500 hover:text-white"
          >
            clear
          </button>
        )}
      </div>

      {/* Flow type legend — bottom right */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 space-y-1 text-[11px] font-mono text-zinc-400">
        <div className="mb-1 text-zinc-600 uppercase tracking-wider">Flow types</div>
        {(Object.keys(FLOW_COLORS) as FlowType[]).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="inline-block h-2 w-3" style={{ backgroundColor: '#' + FLOW_COLORS[k].toString(16).padStart(6, '0') }} />
            <span>{FLOW_LABELS[k]}</span>
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-zinc-800 bg-zinc-950/90 px-2 py-1 text-xs text-white backdrop-blur"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.label}
        </div>
      )}

      {selected && (
        <EntityDrawer selected={selected} data={data} onClose={() => setSelected(null)} />
      )}
      {paletteOpen && (
        <CommandPalette
          data={data}
          onClose={() => setPaletteOpen(false)}
          onSelect={(s) => { setSelected(s); setPaletteOpen(false) }}
        />
      )}
    </div>
  )
}
