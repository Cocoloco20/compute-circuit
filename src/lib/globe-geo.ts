import * as THREE from 'three'

/**
 * Converts latitude/longitude geocoordinates to a 3D Cartesian vector on a sphere of given radius.
 * Maps:
 *   - lat = 90 (North Pole) -> Y = +radius
 *   - lat = -90 (South Pole) -> Y = -radius
 *   - lng = 0 (Prime Meridian) -> Z = -radius
 *   - lng = 90 (East) -> X = +radius
 *   - lng = -90 (West) -> X = -radius
 */
export function cityToVec3(lat: number, lng: number, radius = 5): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)

  const x = -(radius * Math.sin(phi) * Math.sin(theta))
  const y = radius * Math.cos(phi)
  const z = radius * Math.sin(phi) * Math.cos(theta)

  return new THREE.Vector3(x, y, z)
}

/**
 * Computes points along a quadratic Bezier arc rising above the globe surface.
 * The arc height is proportional to the distance between the two points and the flow magnitude.
 */
export function arcPoints(
  fromVec: THREE.Vector3,
  toVec: THREE.Vector3,
  height: number,
  pointsCount = 50
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const dist = fromVec.distanceTo(toVec)

  if (dist < 0.05) {
    for (let i = 0; i <= pointsCount; i++) {
      points.push(new THREE.Vector3().lerpVectors(fromVec, toVec, i / pointsCount))
    }
    return points
  }

  // Midpoint of the chord connecting the two vectors
  const mid = new THREE.Vector3().addVectors(fromVec, toVec).multiplyScalar(0.5)
  // Radial normal direction (pointing outward from the center of the Earth)
  const normal = mid.clone().normalize()
  // Lift the control point along the normal by the height parameter
  const control = mid.clone().add(normal.multiplyScalar(height))

  // Generate points along the quadratic Bezier curve
  // B(t) = (1-t)^2 * P0 + 2*(1-t)*t * P1 + t^2 * P2
  for (let i = 0; i <= pointsCount; i++) {
    const t = i / pointsCount
    const p = new THREE.Vector3()
    p.x = (1 - t) * (1 - t) * fromVec.x + 2 * (1 - t) * t * control.x + t * t * toVec.x
    p.y = (1 - t) * (1 - t) * fromVec.y + 2 * (1 - t) * t * control.y + t * t * toVec.y
    p.z = (1 - t) * (1 - t) * fromVec.z + 2 * (1 - t) * t * control.z + t * t * toVec.z
    points.push(p)
  }

  return points
}

/**
 * Modifies a Three.js material to shade the night side of the Earth dimmer.
 * Integrates a uniform `sunDirectionViewSpace` and adjusts fragment output based on normal dot product.
 */
export function applyDayNightShader(material: THREE.Material, sunDirUniform: { value: THREE.Vector3 }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sunDirectionViewSpace = sunDirUniform

    // Inject uniform declaration at top of fragment shader
    shader.fragmentShader = `
      uniform vec3 sunDirectionViewSpace;
    ` + shader.fragmentShader

    // Inject night-shading logic right before outputting fragment color
    const targetToken = '#include <opaque_fragment>'
    if (shader.fragmentShader.includes(targetToken)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        targetToken,
        `
        #include <opaque_fragment>
        
        // Compute dot product of view-space normal and view-space sun direction
        vec3 norm = normalize(vNormal);
        float dotNormalSun = dot(norm, normalize(sunDirectionViewSpace));
        
        // smooth transition from night (dimmer) to day (full bright)
        float lightIntensity = smoothstep(-0.25, 0.25, dotNormalSun);
        // Dim to 15% brightness on the dark side, blend smoothly to 100% on the light side
        float dayNightFactor = mix(0.15, 1.0, lightIntensity);
        
        gl_FragColor.rgb *= dayNightFactor;
        `
      )
    }
  }
}
