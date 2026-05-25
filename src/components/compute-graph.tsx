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
import { getLogoUrl } from '@/lib/logo'
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
    // Two billboard sprites per node:
    //   1) "badge" — circular Clearbit logo on a white disc with a status-colored ring
    //   2) "label" — ticker or name in a pill below the badge
    // Both always face the camera. Click handlers fire on either sprite via shared userData.
    const nodeMeshes: THREE.Object3D[] = []

    // Draw the fallback state (ring + white disc + initials). Replaced in-place
    // when the Clearbit image loads.
    function paintBadgeFallback(canvas: HTMLCanvasElement, ringColor: string, initials: string) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Outer ring
      ctx.fillStyle = ringColor
      ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill()
      // Inner white disc
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill()
      // Initials (shows until/unless Clearbit logo loads)
      ctx.fillStyle = '#0a0a0f'
      ctx.font = 'bold 44px ui-sans-serif, -apple-system, system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(initials.slice(0, 2).toUpperCase(), 64, 68)
    }
    function paintBadgeLogo(canvas: HTMLCanvasElement, ringColor: string, img: HTMLImageElement) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = ringColor
      ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill()
      // Clip the logo to the inner disc so square logos don't poke outside the ring.
      ctx.save()
      ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.clip()
      const s = 92
      ctx.drawImage(img, (128 - s) / 2, (128 - s) / 2, s, s)
      ctx.restore()
    }

    function makeBadge(opts: { domain: string | null; ringColor: string; initials: string; scale: number }): THREE.Sprite {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 128
      paintBadgeFallback(canvas, opts.ringColor, opts.initials)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(opts.scale, opts.scale, 1)

      const url = getLogoUrl(opts.domain)
      if (url) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => { paintBadgeLogo(canvas, opts.ringColor, img); tex.needsUpdate = true }
        img.onerror = () => { /* keep fallback initials */ }
        img.src = url
      }
      return sprite
    }

    // Text labels (ticker, firm name, bottleneck name) — rendered to an offscreen
    // canvas as a pill so they read against the dark background.
    function makeLabel(text: string, heightUnits: number, accent = '#ffffff'): THREE.Sprite {
      const fontSize = 36
      const font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
      // Measure in a throwaway context first (sizing the canvas resets state).
      const meas = document.createElement('canvas').getContext('2d')!
      meas.font = font
      const w = meas.measureText(text).width
      const padX = 18, padY = 10
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(w + padX * 2)
      canvas.height = fontSize + padY * 2
      const ctx = canvas.getContext('2d')!
      ctx.font = font
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      // Pill background
      ctx.fillStyle = 'rgba(10, 10, 16, 0.85)'
      const r = canvas.height / 2
      ctx.beginPath(); ctx.moveTo(r, 0)
      ctx.lineTo(canvas.width - r, 0); ctx.arcTo(canvas.width, 0, canvas.width, r, r)
      ctx.lineTo(canvas.width, canvas.height - r); ctx.arcTo(canvas.width, canvas.height, canvas.width - r, canvas.height, r)
      ctx.lineTo(r, canvas.height); ctx.arcTo(0, canvas.height, 0, canvas.height - r, r)
      ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
      ctx.closePath(); ctx.fill()
      // Subtle border
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 2
      ctx.stroke()
      // Text
      ctx.fillStyle = accent
      ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1)

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
      const sprite = new THREE.Sprite(mat)
      const aspect = canvas.width / canvas.height
      sprite.scale.set(heightUnits * aspect, heightUnits, 1)
      return sprite
    }

    // Apply backer-filter dimming. Works on both SpriteMaterial and MeshStandardMaterial
    // (they share `transparent` and `opacity`).
    function applyFilterToMaterial(mat: THREE.Material & { opacity: number; transparent: boolean }, matches: boolean) {
      if (!filterSet) return
      mat.transparent = true
      mat.opacity = matches ? 1 : 0.18
    }

    // ----- companies -----
    // Discovered-via-scraper companies start with layer_id=null. Skip them in
    // the 3D scene so the visual stays curated — they still show in drawers.
    data.companies.forEach((c) => {
      if (!c.layer_id) return
      const pos = positions.companyPos.get(c.id)
      if (!pos) return
      // Size by importance weight; ring color encodes status (gold=held, blue=private, slate=public).
      const scale = 0.95 + Math.min(c.weight, 10) * 0.09
      const ringHex = c.position_held ? '#fbbf24' : c.private ? '#60a5fa' : '#475569'
      const initials = c.ticker ?? c.name

      const badge = makeBadge({ domain: c.domain, ringColor: ringHex, initials, scale })
      badge.position.set(pos.x, pos.y, pos.z)
      badge.userData = { kind: 'company', id: c.id, label: `${c.name}${c.ticker ? ` · ${c.ticker}` : ''}` }
      applyFilterToMaterial(badge.material, !filterSet || filterSet.companies.has(c.id))
      scene.add(badge)
      nodeMeshes.push(badge)

      // Ticker pill (or first word of name for private cos)
      const labelText = c.ticker ?? c.name.split(' ')[0]
      const labelAccent = c.position_held ? '#fde68a' : c.private ? '#bfdbfe' : '#e2e8f0'
      const label = makeLabel(labelText, 0.34, labelAccent)
      label.position.set(pos.x, pos.y - scale * 0.62, pos.z)
      label.userData = { kind: 'company', id: c.id, label: c.name }
      applyFilterToMaterial(label.material, !filterSet || filterSet.companies.has(c.id))
      scene.add(label)
      nodeMeshes.push(label)
    })

    // ----- investors -----
    data.investors.forEach((inv) => {
      const pos = positions.investorPos.get(inv.id)
      if (!pos) return
      const badge = makeBadge({ domain: inv.domain, ringColor: '#c084fc', initials: inv.name, scale: 1.35 })
      badge.position.set(pos.x, pos.y, pos.z)
      badge.userData = { kind: 'investor', id: inv.id, label: inv.name }
      applyFilterToMaterial(badge.material, !filterSet || filterSet.investors.has(inv.id))
      scene.add(badge)
      nodeMeshes.push(badge)

      const label = makeLabel(inv.name, 0.36, '#e9d5ff')
      label.position.set(pos.x, pos.y - 0.95, pos.z)
      label.userData = { kind: 'investor', id: inv.id, label: inv.name }
      applyFilterToMaterial(label.material, !filterSet || filterSet.investors.has(inv.id))
      scene.add(label)
      nodeMeshes.push(label)
    })

    // ----- bottlenecks (kept as glowing octahedra — they're not companies) -----
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

      // Bottleneck label — short name, orange-tinted to match the severity vibe
      const accent =
        b.severity === 'critical' ? '#fecaca' :
        b.severity === 'high' ? '#fed7aa' : '#fde68a'
      const bnLabel = makeLabel(b.name, 0.32, accent)
      bnLabel.position.set(pos.x, pos.y - 0.85, pos.z)
      bnLabel.userData = { kind: 'bottleneck', id: b.id, label: b.name }
      scene.add(bnLabel)
      nodeMeshes.push(bnLabel)
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
            {data.companies.filter(c => c.layer_id).length} cos
            {data.companies.filter(c => !c.layer_id).length > 0 && (
              <span className="text-zinc-600"> (+{data.companies.filter(c => !c.layer_id).length} unplaced)</span>
            )}
            <span> · {data.investors.length} investors · {data.flows.length} flows · {data.bottlenecks.length} bottlenecks</span>
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

      {/* Chrome telemetry — GasCity-style "instrument is live" bar at bottom-center */}
      <ChromeTelemetry lastUpdates={data.lastUpdates} />

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

// ---------- Chrome telemetry (GasCity-style "instrument is live" bar) ----------

function ChromeTelemetry({ lastUpdates }: { lastUpdates: GraphData['lastUpdates'] }) {
  const entries: Array<{ label: string; iso: string | null; textColor: string; dotColor: string }> = [
    { label: 'PRICE',   iso: lastUpdates.price,    textColor: 'text-emerald-400', dotColor: 'bg-emerald-400' },
    { label: 'NEWS',    iso: lastUpdates.news,     textColor: 'text-cyan-400',    dotColor: 'bg-cyan-400'    },
    { label: '8-K',     iso: lastUpdates.filings,  textColor: 'text-orange-400',  dotColor: 'bg-orange-400'  },
    { label: 'INSIDER', iso: lastUpdates.insider,  textColor: 'text-red-400',     dotColor: 'bg-red-400'     },
    { label: '13F',     iso: lastUpdates.holdings, textColor: 'text-emerald-400', dotColor: 'bg-emerald-400' },
    { label: 'HF',      iso: lastUpdates.hf,       textColor: 'text-amber-400',   dotColor: 'bg-amber-400'   },
    { label: 'GRID',    iso: lastUpdates.grid,     textColor: 'text-yellow-400',  dotColor: 'bg-yellow-400'  },
    { label: 'IP',      iso: lastUpdates.patents,  textColor: 'text-violet-400',  dotColor: 'bg-violet-400'  },
    { label: 'JOBS',    iso: lastUpdates.jobs,     textColor: 'text-pink-400',    dotColor: 'bg-pink-400'    },
  ]
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded border border-zinc-800 bg-zinc-950/70 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 backdrop-blur">
      <span className="text-zinc-600">LIVE</span>
      {entries.map((e) => (
        <span key={e.label} className="flex items-center gap-1">
          <span className={'inline-block h-1.5 w-1.5 rounded-full ' + (e.iso ? e.dotColor : 'bg-zinc-700')} />
          <span className="text-zinc-500">{e.label}</span>
          <span className={e.iso ? e.textColor : 'text-zinc-700'}>{e.iso ? agoStr(e.iso) : 'never'}</span>
        </span>
      ))}
    </div>
  )
}

function agoStr(iso: string): string {
  const t = new Date(iso).getTime()
  const diffMs = Date.now() - t
  const diffHr = Math.floor(diffMs / 3_600_000)
  if (diffHr < 1) {
    const diffMin = Math.floor(diffMs / 60_000)
    return diffMin < 1 ? 'now' : `${diffMin}m`
  }
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d`
}
