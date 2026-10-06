import * as THREE from 'three';

/**
 * An art-directed sky. Colours come from keyframes by sun height rather than from a physical
 * scattering model, which gives reliable sunsets, blue hours and nights:
 *  - a horizon → zenith gradient with a soft glow around the sun, stronger when the sun is low
 *  - sun disc, moon with a halo, twinkling stars and a faint Milky Way band
 *  - a drifting fbm cloud layer lit by the sun's colour (orange at sunset), dimmed by weather
 * The same dome is rendered into the environment map and sampled for the horizon fog.
 */

// Palette keyframes by sun height (sunDir.y). Colours are sRGB.
const KEYS = [
  [-0.35, { zenith: '#03050c', horizon: '#0b1120', sun: '#8fa5d8', sunI: 0.34, amb: 0.32, stars: 1.0, exp: 0.9 }],
  [-0.12, { zenith: '#070c1c', horizon: '#1a1e36', sun: '#9aa8d0', sunI: 0.28, amb: 0.3, stars: 0.9, exp: 0.92 }],
  [-0.03, { zenith: '#182347', horizon: '#5a3a55', sun: '#ff8a4a', sunI: 0.32, amb: 0.22, stars: 0.5, exp: 0.95 }],
  [0.02, { zenith: '#2e4c86', horizon: '#f0904e', sun: '#ff9a55', sunI: 0.9, amb: 0.35, stars: 0.15, exp: 1.0 }],
  [0.12, { zenith: '#3f72c4', horizon: '#e4b487', sun: '#ffd09a', sunI: 1.6, amb: 0.5, stars: 0, exp: 1.0 }],
  [0.35, { zenith: '#2c6bcf', horizon: '#bfd8ed', sun: '#fff1da', sunI: 2.3, amb: 0.62, stars: 0, exp: 1.0 }],
  [1.0, { zenith: '#2461c9', horizon: '#b6d3ec', sun: '#fffaf0', sunI: 2.5, amb: 0.68, stars: 0, exp: 1.0 }],
].map(([e, k]) => [e, {
  zenith: new THREE.Color(k.zenith), horizon: new THREE.Color(k.horizon), sun: new THREE.Color(k.sun),
  sunI: k.sunI, amb: k.amb, stars: k.stars, exp: k.exp,
}]);

const GREY = new THREE.Color(0.5, 0.53, 0.57);

/** Palette for a sun height, blended smoothly between keyframes and greyed by overcast weather. */
export function skyPalette(sunY, overcast = 0, out = createPalette()) {
  let i = 0;
  while (i < KEYS.length - 2 && sunY > KEYS[i + 1][0]) i++;
  const [e0, k0] = KEYS[i], [e1, k1] = KEYS[i + 1];
  let t = Math.min(1, Math.max(0, (sunY - e0) / (e1 - e0)));
  t = t * t * (3 - 2 * t);
  const mix = (a, b) => a + (b - a) * t;
  out.zenith.copy(k0.zenith).lerp(k1.zenith, t);
  out.horizon.copy(k0.horizon).lerp(k1.horizon, t);
  out.sun.copy(k0.sun).lerp(k1.sun, t);
  out.sunI = mix(k0.sunI, k1.sunI);
  out.amb = mix(k0.amb, k1.amb);
  out.stars = mix(k0.stars, k1.stars);
  out.exp = mix(k0.exp, k1.exp);

  // Overcast: a grey lid. Keep its brightness tied to the time of day.
  if (overcast > 0) {
    const brightness = (out.horizon.r + out.horizon.g + out.horizon.b) / 3;
    const grey = GREY.clone().multiplyScalar(Math.min(1.2, brightness * 1.3 + 0.02));
    out.zenith.lerp(grey, overcast * 0.85);
    out.horizon.lerp(grey, overcast * 0.75);
    out.sunI *= 1 - overcast * 0.7;
    out.stars *= 1 - overcast;
  }
  out.ground.copy(out.horizon).multiplyScalar(0.82);
  return out;
}

export function createPalette() {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(),
    sunI: 0, amb: 0, stars: 0, exp: 1,
  };
}

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunI;
  uniform vec3 uMoonDir;
  uniform float uNight;
  uniform float uStars;
  uniform float uTime;
  uniform float uCloudCover;
  uniform float uOvercast;
  uniform vec2 uCloudWind;
  uniform float uFlash;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int o = 0; o < 5; o++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  vec3 skyBase(vec3 d) {
    if (d.y >= 0.0) return mix(uHorizon, uZenith, pow(d.y, 0.42));
    return mix(uHorizon, uGround, smoothstep(0.0, 0.3, -d.y));
  }
  vec3 skyGlow(vec3 d) {
    float c = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.4, uSunDir.y);
    float g = pow(c, 12.0) * 0.30 + pow(c, 96.0) * 1.2 + pow(c, 3.0) * 0.42 * low;
    g *= smoothstep(-0.25, 0.05, d.y) * 0.85 + 0.15;
    return uSunColor * g * uSunI * (1.0 - 0.75 * uOvercast);
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = skyBase(d) + skyGlow(d);

    // Sun disc, hidden behind thick cloud.
    float cosA = dot(d, uSunDir);
    float disc = smoothstep(0.99955, 0.99985, cosA) * smoothstep(-0.03, 0.03, d.y) * smoothstep(-0.08, 0.0, uSunDir.y);
    col += uSunColor * disc * 6.0 * max(uSunI, 0.2) * (1.0 - uOvercast);

    // Moon and its halo.
    float cosM = dot(d, uMoonDir);
    float moon = smoothstep(0.99965, 0.99985, cosM) * smoothstep(-0.02, 0.05, d.y);
    float moonGlow = pow(max(cosM, 0.0), 220.0) * 0.22;
    col += vec3(0.85, 0.9, 1.0) * (moon * 1.3 + moonGlow) * uNight * (1.0 - 0.8 * uOvercast);

    // Stars and a faint Milky Way band.
    if (uStars > 0.001 && d.y > -0.05) {
      vec3 p = d * 210.0;
      vec3 ip = floor(p);
      vec3 fp = fract(p) - 0.5;
      float star = step(0.9925, hash13(ip));
      float b = hash13(ip + 7.1) * 0.85 + 0.15;
      float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + hash13(ip + 3.3) * 4.0) + hash13(ip + 9.7) * 6.2832);
      float s = star * smoothstep(0.28, 0.0, length(fp)) * b * twinkle;
      float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.25, 1.0))) * 3.2, 2.0));
      float milky = band * (0.35 + 0.65 * vnoise(vec2(d.x * 22.0 + d.y * 9.0, d.z * 22.0 - d.y * 7.0))) * 0.12;
      col += (vec3(s) + vec3(0.65, 0.7, 0.9) * milky) * uStars * smoothstep(-0.05, 0.15, d.y);
    }

    // Cloud layer: fbm on a plane above, lit by the sun's colour, fading towards the horizon.
    if (d.y > 0.0 && uCloudCover > 0.01) {
      vec2 uv = d.xz / (d.y + 0.12) * 1.6 + uCloudWind;
      float n = fbm(uv);
      float edge = 0.62 - uCloudCover * 0.42;
      float cover = smoothstep(edge, edge + 0.32, n) * smoothstep(0.0, 0.18, d.y);
      float thick = smoothstep(edge, edge + 0.6, fbm(uv * 1.7 + 3.1));
      vec3 lit = uSunColor * uSunI * 0.42 + uHorizon * 0.55;
      vec3 shade = mix(uHorizon, uZenith, 0.35) * 0.72;
      vec3 cloud = mix(lit, shade, thick * 0.75 + uOvercast * 0.3);
      // Silver lining near the sun.
      cloud += uSunColor * pow(max(cosA, 0.0), 24.0) * uSunI * 0.6 * (1.0 - thick);
      col = mix(col, cloud, cover * 0.92);
    }

    col += vec3(0.8, 0.85, 1.0) * uFlash;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class SkyDome {
  constructor(radius) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunI: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uNight: { value: 0 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCloudCover: { value: 0.2 },
      uOvercast: { value: 0 },
      uCloudWind: { value: new THREE.Vector2() },
      uFlash: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  /** A second dome sharing these uniforms by reference (for rendering into the environment map). */
  clone() {
    const mesh = new THREE.Mesh(this.mesh.geometry, this.material);
    mesh.frustumCulled = false;
    return mesh;
  }

  apply(palette, { sunDir, moonDir, night, cloud, overcast }) {
    const u = this.uniforms;
    u.uZenith.value.copy(palette.zenith);
    u.uHorizon.value.copy(palette.horizon);
    u.uGround.value.copy(palette.ground);
    u.uSunColor.value.copy(palette.sun);
    u.uSunI.value = palette.sunI;
    u.uStars.value = palette.stars;
    u.uSunDir.value.copy(sunDir);
    u.uMoonDir.value.copy(moonDir);
    u.uNight.value = night;
    u.uCloudCover.value = cloud;
    u.uOvercast.value = overcast;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
