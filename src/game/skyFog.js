import * as THREE from 'three';

const SAMPLES = 32;
const SAMPLE_ELEVATION = THREE.MathUtils.degToRad(0.8);

/**
 * Fog that fades into the sky's own horizon colour in every direction. A single fog colour can't
 * match a physical sky, which is much brighter towards the sun, so the horizon is sampled all the
 * way round into a 1D texture and the materials' fog chunk looks it up by view azimuth.
 */
export class SkyFog {
  constructor(renderer, sky) {
    this.texture = new THREE.DataTexture(sampleHorizon(renderer, sky), SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.uniform = { value: this.texture };
  }

  /** Re-samples the horizon, e.g. after the sun has moved. */
  update(renderer, sky) {
    this.texture.image.data.set(sampleHorizon(renderer, sky));
    this.texture.needsUpdate = true;
  }

  /** Patches a material so its fog uses the horizon texture. Safe to call on materials with their own onBeforeCompile. */
  apply(material) {
    if (material.userData.skyFog) return;
    material.userData.skyFog = true;

    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.skyFogMap = this.uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vSkyFogDir;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSkyFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nvarying vec3 vSkyFogDir;\nuniform sampler2D skyFogMap;')
        .replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            float skyFogU = atan(vSkyFogDir.x, vSkyFogDir.z) / (2.0 * PI) + 0.5;
            vec3 skyFogColor = texture2D(skyFogMap, vec2(skyFogU, 0.5)).rgb;
            // Fog is mixed in after tone mapping, so convert the HDR sky sample the same way the sky shader does.
            #ifdef TONE_MAPPING
              skyFogColor = toneMapping(skyFogColor);
            #endif
            skyFogColor = linearToOutputTexel(vec4(skyFogColor, 1.0)).rgb;
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, skyFogColor, fogFactor);
          #endif`);
    };
    material.customProgramCacheKey = () => `skyfog|${previousKey}`;
    material.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/**
 * Renders a narrow view just above the horizon at evenly spaced azimuths and averages each into a texel.
 * Returns half-float RGBA data (half floats keep HDR values and filter linearly on every WebGL2 device).
 */
function sampleHorizon(renderer, sky) {
  const size = 4;
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType });
  const camera = new THREE.PerspectiveCamera(1, 1, 1, sky.scale.x);
  const scene = new THREE.Scene();
  const parent = sky.parent;
  scene.add(sky);

  const pixels = new Float32Array(size * size * 4);
  const data = new Float32Array(SAMPLES * 4);
  for (let i = 0; i < SAMPLES; i++) {
    // Texel i covers azimuth atan(x, z) = ((i + 0.5) / SAMPLES - 0.5) * 2π, matching the shader lookup.
    const angle = ((i + 0.5) / SAMPLES - 0.5) * Math.PI * 2;
    camera.lookAt(Math.sin(angle), Math.tan(SAMPLE_ELEVATION), Math.cos(angle));
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);

    for (let p = 0; p < pixels.length; p += 4) {
      data[i * 4] += pixels[p] / (size * size);
      data[i * 4 + 1] += pixels[p + 1] / (size * size);
      data[i * 4 + 2] += pixels[p + 2] / (size * size);
    }
    data[i * 4 + 3] = 1;
  }
  renderer.setRenderTarget(null);
  parent?.add(sky);
  target.dispose();

  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  return half;
}
