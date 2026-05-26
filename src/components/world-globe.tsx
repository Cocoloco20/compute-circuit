'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Company, FlowType } from '@/types/db'
import type { GraphData } from '@/lib/graph-data'
import { getLogoUrl } from '@/lib/logo'
import { cityToVec3, arcPoints, applyDayNightShader } from '@/lib/globe-geo'
import type { SelectedRef } from './compute-graph'

const FLOW_COLORS: Record<FlowType, number> = {
  money:     0x10b981, // emerald
  compute:   0x22d3ee, // cyan
  energy:    0xfbbf24, // amber
  equipment: 0xcbd5e1, // slate-300
  intel:     0xa855f7, // purple
  venture:   0xec4899, // pink
}

const BG_COLOR = 0x05060a
const GLOBE_RADIUS = 5.0
const ZOOM_LOD_THRESHOLD = 14.0 // threshold camera distance to expand clusters

interface WorldGlobeProps {
  data: GraphData
  onSelect: (ref: SelectedRef | null) => void
  selected: SelectedRef | null
  filterSet: { companies: Set<string>; investors: Set<string> } | null
}

interface Cluster {
  key: string
  centerLat: number
  centerLng: number
  companies: Company[]
  topCompany: Company
}

export default function WorldGlobe({ data, onSelect, selected, filterSet }: WorldGlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ label: string; x: number; y: number } | null>(null)

  // 1. Group companies into clusters based on rounded lat/lng grid coordinates (approx 2 degrees resolution)
  const clusters = useMemo(() => {
    const gridMap = new Map<string, Company[]>()
    data.companies.forEach((c) => {
      if (c.hq_lat == null || c.hq_lng == null) return
      // Round to nearest 2 degrees for grid resolution
      const gridLat = Math.round(c.hq_lat / 2) * 2
      const gridLng = Math.round(c.hq_lng / 2) * 2
      const key = `${gridLat},${gridLng}`
      if (!gridMap.has(key)) gridMap.set(key, [])
      gridMap.get(key)!.push(c)
    })

    const result: Cluster[] = []
    gridMap.forEach((cos, key) => {
      // Sort by weight desc so the first one is the cluster head
      cos.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      
      // Calculate average coordinates for the cluster center
      const sumLat = cos.reduce((acc, c) => acc + c.hq_lat!, 0)
      const sumLng = cos.reduce((acc, c) => acc + c.hq_lng!, 0)
      
      result.push({
        key,
        centerLat: sumLat / cos.length,
        centerLng: sumLng / cos.length,
        companies: cos,
        topCompany: cos[0]
      })
    })
    return result
  }, [data.companies])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ----- Scene, Camera, Renderer Setup -----
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BG_COLOR)
    scene.fog = new THREE.Fog(BG_COLOR, 15, 45)

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 100)
    // Default position zoomed out to see the whole earth
    camera.position.set(0, 5, 17)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 6.2
    controls.maxDistance = 25
    controls.target.set(0, 0, 0)

    // ----- Lighting -----
    scene.add(new THREE.AmbientLight(0xffffff, 0.4))
    
    // Directional light representing the sun
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8)
    scene.add(sunLight)

    // Soft rim light
    const rimLight = new THREE.PointLight(0x4f46e5, 0.4, 30)
    rimLight.position.set(-10, 5, -10)
    scene.add(rimLight)

    // ----- Earth Sphere -----
    const earthGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64)
    
    // Load Texture
    const textureLoader = new THREE.TextureLoader()
    const earthTex = textureLoader.load('/textures/earth.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
    })

    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 0.8,
      metalness: 0.1,
    })

    // Setup uniform for Day/Night shader (rotating sun)
    const sunDirectionViewSpace = new THREE.Vector3()
    const sunDirUniform = { value: sunDirectionViewSpace }
    applyDayNightShader(earthMat, sunDirUniform)

    const earthMesh = new THREE.Mesh(earthGeo, earthMat)
    scene.add(earthMesh)

    // Faint grid lines on Earth
    const gridGeo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.01, 32, 16)
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x1f2937,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    })
    const earthGrid = new THREE.Mesh(gridGeo, gridMat)
    scene.add(earthGrid)

    // ----- Billboards Rendering & Click Handling -----
    const interactables: THREE.Object3D[] = []
    
    // Keep tracks of meshes to toggle their visibility based on zoom LOD
    const clusterHeadMeshes: THREE.Object3D[] = []
    const individualMeshes: THREE.Object3D[] = []

    // Helper functions to paint badges and labels onto canvases
    function paintBadgeFallback(canvas: HTMLCanvasElement, ringColor: string, initials: string) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = ringColor
      ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill()
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
        img.src = url
      }
      return sprite
    }

    function makeLabel(text: string, heightUnits: number, accent = '#ffffff'): THREE.Sprite {
      const fontSize = 36
      const font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
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
      
      ctx.fillStyle = 'rgba(10, 10, 16, 0.85)'
      const r = canvas.height / 2
      ctx.beginPath(); ctx.moveTo(r, 0)
      ctx.lineTo(canvas.width - r, 0); ctx.arcTo(canvas.width, 0, canvas.width, r, r)
      ctx.lineTo(canvas.width, canvas.height - r); ctx.arcTo(canvas.width, canvas.height, canvas.width - r, canvas.height, r)
      ctx.lineTo(r, canvas.height); ctx.arcTo(0, canvas.height, 0, canvas.height - r, r)
      ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
      ctx.closePath(); ctx.fill()

      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 2
      ctx.stroke()

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

    // Dynamic Filter opacity helper
    function applyFilter(mat: THREE.Material & { opacity: number; transparent: boolean }, matches: boolean) {
      if (!filterSet) return
      mat.transparent = true
      mat.opacity = matches ? 1 : 0.15
    }

    // Build the 3D meshes for clusters
    clusters.forEach((cl) => {
      // --- A. Render Cluster Head ---
      const headPos = cityToVec3(cl.centerLat, cl.centerLng, GLOBE_RADIUS + 0.15)
      const isSelected = selected && cl.companies.some(c => c.id === selected.id)
      
      const headRingHex = isSelected ? '#38bdf8' : (cl.topCompany.position_held ? '#fbbf24' : cl.topCompany.private ? '#60a5fa' : '#475569')
      const headInitials = cl.topCompany.ticker ?? cl.topCompany.name
      const clScale = 0.55 + Math.min(cl.topCompany.weight, 10) * 0.05
      
      // Cluster Head Badge
      const headBadge = makeBadge({ domain: cl.topCompany.domain, ringColor: headRingHex, initials: headInitials, scale: clScale })
      headBadge.position.copy(headPos)
      
      // Store reference to parent top company for single selection, or top company of cluster
      headBadge.userData = { kind: 'company', id: cl.topCompany.id, label: cl.companies.length > 1 ? `${cl.topCompany.name} (+${cl.companies.length - 1} in ${cl.topCompany.hq_city})` : cl.topCompany.name, lat: cl.centerLat, lng: cl.centerLng }
      
      const inFilter = !filterSet || cl.companies.some(c => filterSet.companies.has(c.id))
      applyFilter(headBadge.material, inFilter)
      scene.add(headBadge)
      interactables.push(headBadge)
      clusterHeadMeshes.push(headBadge)

      // Cluster Head Label
      const labelText = cl.companies.length > 1 ? `${cl.topCompany.ticker ?? cl.topCompany.name.split(' ')[0]} (+${cl.companies.length - 1})` : (cl.topCompany.ticker ?? cl.topCompany.name.split(' ')[0])
      const labelAccent = cl.topCompany.position_held ? '#fde68a' : cl.topCompany.private ? '#bfdbfe' : '#e2e8f0'
      const headLabel = makeLabel(labelText, 0.22, labelAccent)
      headLabel.position.set(headPos.x, headPos.y - (clScale * 0.55), headPos.z)
      headLabel.userData = headBadge.userData
      applyFilter(headLabel.material, inFilter)
      scene.add(headLabel)
      interactables.push(headLabel)
      clusterHeadMeshes.push(headLabel)

      // --- B. Render Individual Dispersed Companies ---
      cl.companies.forEach((co, idx) => {
        // Disperse coordinates using a tiny spiral offset based on index
        const angle = (idx / cl.companies.length) * Math.PI * 2
        // 0.4 degree offset for a tight but clean separation
        const offsetDistance = cl.companies.length > 1 ? (0.35 + 0.1 * idx) : 0
        const dispLat = co.hq_lat! + Math.sin(angle) * offsetDistance
        const dispLng = co.hq_lng! + Math.cos(angle) * offsetDistance
        const dispPos = cityToVec3(dispLat, dispLng, GLOBE_RADIUS + 0.15)
        
        const coSelected = selected && selected.id === co.id
        const coRingHex = coSelected ? '#38bdf8' : (co.position_held ? '#fbbf24' : co.private ? '#60a5fa' : '#475569')
        const coInitials = co.ticker ?? co.name
        const coScale = 0.45 + Math.min(co.weight, 10) * 0.04
        
        const coBadge = makeBadge({ domain: co.domain, ringColor: coRingHex, initials: coInitials, scale: coScale })
        coBadge.position.copy(dispPos)
        coBadge.userData = { kind: 'company', id: co.id, label: co.name, lat: co.hq_lat, lng: co.hq_lng }
        
        const coInFilter = !filterSet || filterSet.companies.has(co.id)
        applyFilter(coBadge.material, coInFilter)
        scene.add(coBadge)
        interactables.push(coBadge)
        individualMeshes.push(coBadge)

        const coLabelText = co.ticker ?? co.name.split(' ')[0]
        const coLabelAccent = co.position_held ? '#fde68a' : co.private ? '#bfdbfe' : '#e2e8f0'
        const coLabel = makeLabel(coLabelText, 0.18, coLabelAccent)
        coLabel.position.set(dispPos.x, dispPos.y - (coScale * 0.55), dispPos.z)
        coLabel.userData = coBadge.userData
        applyFilter(coLabel.material, coInFilter)
        scene.add(coLabel)
        interactables.push(coLabel)
        individualMeshes.push(coLabel)
      })
    })

    // ----- Flow Arcs Rendering -----
    const flowAnims: Array<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      curve: THREE.Curve<any>
      particle: THREE.Mesh
      speed: number
      magnitude: number
      isActive: boolean
    }> = []

    data.flows.forEach((flow) => {
      // Find coordinates for from / to companies
      const fromCo = data.companies.find(c => c.id === flow.from_id)
      const toCo = data.companies.find(c => c.id === flow.to_id)
      if (!fromCo || !toCo || fromCo.hq_lat == null || fromCo.hq_lng == null || toCo.hq_lat == null || toCo.hq_lng == null) return

      const fromVec = cityToVec3(fromCo.hq_lat, fromCo.hq_lng, GLOBE_RADIUS + 0.05)
      const toVec = cityToVec3(toCo.hq_lat, toCo.hq_lng, GLOBE_RADIUS + 0.05)

      // Calculate arc height based on distance (so long distance flows rise higher)
      const dist = fromVec.distanceTo(toVec)
      const arcHeight = dist * 0.25 + (flow.magnitude * 0.05)
      
      const pts = arcPoints(fromVec, toVec, arcHeight, 50)
      const curve = new THREE.CatmullRomCurve3(pts)

      const flowMatches = !filterSet || (
        ((flow.from_kind === 'company' && filterSet.companies.has(flow.from_id)) ||
         (flow.from_kind === 'investor' && filterSet.investors.has(flow.from_id))) ||
        ((flow.to_kind === 'company' && filterSet.companies.has(flow.to_id)) ||
         (flow.to_kind === 'investor' && filterSet.investors.has(flow.to_id)))
      )

      // Draw the static arc tube
      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.012, 4, false)
      const lineMat = new THREE.MeshBasicMaterial({
        color: FLOW_COLORS[flow.type],
        transparent: true,
        opacity: flowMatches ? 0.25 : 0.05,
      })
      const tube = new THREE.Mesh(tubeGeo, lineMat)
      scene.add(tube)

      // Add a traveling particle for the active animation pulse (glowing sphere)
      const pGeo = new THREE.SphereGeometry(0.045, 6, 6)
      const pMat = new THREE.MeshBasicMaterial({
        color: FLOW_COLORS[flow.type],
        transparent: true,
        opacity: flowMatches ? 0.9 : 0.15,
      })
      const particle = new THREE.Mesh(pGeo, pMat)
      scene.add(particle)

      flowAnims.push({
        curve,
        particle,
        // Speed: faster for higher magnitude
        speed: 0.3 + flow.magnitude * 0.08,
        magnitude: flow.magnitude,
        isActive: flowMatches
      })
    })

    // ----- Selected City Glow (custom additive sprite) -----
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = 64
    glowCanvas.height = 64
    const glowCtx = glowCanvas.getContext('2d')!
    const glowGrad = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32)
    glowGrad.addColorStop(0, 'rgba(34, 211, 238, 0.75)') // Cyan glow
    glowGrad.addColorStop(0.5, 'rgba(34, 211, 238, 0.25)')
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    glowCtx.fillStyle = glowGrad
    glowCtx.fillRect(0, 0, 64, 64)
    
    const glowTexture = new THREE.CanvasTexture(glowCanvas)
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    const focusGlow = new THREE.Sprite(glowMat)
    focusGlow.scale.set(1.5, 1.5, 1)
    focusGlow.visible = false
    scene.add(focusGlow)

    // ----- Raycasting -----
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    function pickNode(clientX: number, clientY: number): THREE.Sprite | undefined {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      
      // Narrow raycast only to currently visible interactable badges / labels
      const visibleInteractables = interactables.filter(obj => obj.visible)
      const hits = raycaster.intersectObjects(visibleInteractables, false)
      return hits[0]?.object as THREE.Sprite | undefined
    }

    // Camera Focus Tween target state variables
    let isTweening = false
    const tweenTargetCamera = new THREE.Vector3()
    const tweenTargetControl = new THREE.Vector3()

    function focusOnCoordinates(lat: number, lng: number) {
      const targetPos = cityToVec3(lat, lng, GLOBE_RADIUS + 0.15)
      
      // Position the camera 4 units back from the surface point along the normal
      const normal = targetPos.clone().normalize()
      tweenTargetCamera.copy(targetPos).add(normal.multiplyScalar(4.0))
      
      // Target for controls orbit
      tweenTargetControl.copy(targetPos)
      isTweening = true

      // Position the visual glow under the focused city
      focusGlow.position.copy(targetPos).multiplyScalar(1.01) // slightly elevated
      focusGlow.visible = true
    }

    // Click handler
    function onClick(e: MouseEvent) {
      const hit = pickNode(e.clientX, e.clientY)
      if (hit && hit.userData && hit.userData.id) {
        onSelect({ kind: 'company', id: hit.userData.id })
        focusOnCoordinates(hit.userData.lat, hit.userData.lng)
      } else {
        // If clicked on empty space, close selection and hide glow
        // but only if we didn't drag the controls
      }
    }

    // Pointermove hover handler
    function onPointerMove(e: PointerEvent) {
      const hit = pickNode(e.clientX, e.clientY)
      if (hit && hit.userData) {
        setHover({ label: hit.userData.label, x: e.clientX, y: e.clientY })
        renderer.domElement.style.cursor = 'pointer'
      } else {
        setHover(null)
        renderer.domElement.style.cursor = 'grab'
      }
    }

    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('pointermove', onPointerMove)

    // ----- If a company was selected externally, focus the camera on it -----
    if (selected) {
      const selCo = data.companies.find(c => c.id === selected.id)
      if (selCo && selCo.hq_lat != null && selCo.hq_lng != null) {
        focusOnCoordinates(selCo.hq_lat, selCo.hq_lng)
      }
    }

    // ----- Render Loop -----
    let raf = 0
    const t0 = performance.now()
    
    function tick() {
      const now = performance.now()
      const t = (now - t0) * 0.001
      
      // Update orbit controls
      controls.update()

      // Slow orbit rotation of the sun (defines the day/night line)
      // Rotates once every 60 seconds
      const sunAngle = (now / 30000.0) * Math.PI * 2
      const sunY = 1.5 // offset north slightly
      sunLight.position.set(Math.cos(sunAngle) * 20, sunY, Math.sin(sunAngle) * 20).normalize()
      
      // Compute sun direction in view space for the day/night fragment shader
      sunDirectionViewSpace.copy(sunLight.position).applyMatrix4(camera.matrixWorldInverse).normalize()

      // Slow pulse animation for selected city glow
      if (focusGlow.visible) {
        const pulseScale = 1.4 + Math.sin(t * 5.0) * 0.25
        focusGlow.scale.set(pulseScale, pulseScale, 1)
      }

      // LOD Check: Toggle cluster heads vs dispersed individual companies based on zoom distance
      const distance = camera.position.distanceTo(controls.target)
      const showDispersed = distance <= ZOOM_LOD_THRESHOLD
      
      clusterHeadMeshes.forEach(mesh => mesh.visible = !showDispersed)
      individualMeshes.forEach(mesh => mesh.visible = showDispersed)

      // Animate active flow pulses (beam traveling from A to B every 5 seconds)
      const cycleTime = 5.0 // seconds
      const pulseDuration = 2.0 // seconds
      const timeInCycle = t % cycleTime

      flowAnims.forEach(({ curve, particle }) => {
        if (timeInCycle < pulseDuration) {
          const progress = timeInCycle / pulseDuration
          const point = curve.getPoint(progress)
          particle.position.copy(point)
          particle.visible = true
        } else {
          particle.visible = false
        }
      })

      // Interpolate camera / control targets if tweening on focus
      if (isTweening) {
        camera.position.lerp(tweenTargetCamera, 0.08)
        controls.target.lerp(tweenTargetControl, 0.08)
        
        // Stop tweening when close enough
        if (camera.position.distanceTo(tweenTargetCamera) < 0.03 && controls.target.distanceTo(tweenTargetControl) < 0.03) {
          camera.position.copy(tweenTargetCamera)
          controls.target.copy(tweenTargetControl)
          isTweening = false
        }
      }

      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }

    tick()

    // ----- Resize Handler -----
    function onResize() {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(mount)

    // ----- Cleanup -----
    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      controls.dispose()
      
      // Deep dispose materials and geometries
      scene.traverse((obj) => {
        const disposable = obj as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
        disposable.geometry?.dispose()
        if (disposable.material) {
          const mats = Array.isArray(disposable.material) ? disposable.material : [disposable.material]
          mats.forEach((mat) => {
            const m = mat as THREE.MeshStandardMaterial & { map?: THREE.Texture }
            m.map?.dispose()
            m.dispose()
          })
        }
      })
      glowTexture.dispose()
      glowMat.dispose()
      earthTex.dispose()
      earthMat.dispose()
      gridMat.dispose()
      renderer.dispose()
      
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [clusters, data.flows, data.companies, selected, filterSet, onSelect])

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />
      
      {/* Dynamic hover tooltip for companies */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-border-default bg-bg-overlay px-2 py-1 text-xs text-fg-primary backdrop-blur"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.label}
        </div>
      )}
    </div>
  )
}
