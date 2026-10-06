import * as THREE from 'three';
import { Colliders } from './Colliders.js';

/** Creates the scene objects for a world built by the worker. */
export function createWorld(data) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (...items) => (disposables.push(...items), items[0]);

  const buildingMaterial = track(createBuildingMaterial());
  for (const chunk of data.buildingChunks) {
    if (!chunk.index.length) continue;
    const mesh = new THREE.Mesh(track(toGeometry(chunk, true)), buildingMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const groundMaterial = track(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  }));
  if (data.ground.index.length) {
    const ground = new THREE.Mesh(track(toGeometry(data.ground)), groundMaterial);
    ground.receiveShadow = true;
    group.add(ground);
  }

  const waterMaterial = track(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.08, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  }));
  if (data.water.index.length) {
    const water = new THREE.Mesh(track(toGeometry(data.water)), waterMaterial);
    water.receiveShadow = true;
    group.add(water);
  }

  // Base land under everything, large enough to reach into the fog.
  const baseGeometry = track(new THREE.CircleGeometry(data.radius * 6, 64).rotateX(-Math.PI / 2));
  const baseMaterial = track(new THREE.MeshStandardMaterial({ color: 0x8a8f78, roughness: 1 }));
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.receiveShadow = true;
  group.add(base);

  group.add(createTrees(data.trees, track));

  return {
    group,
    radius: data.radius,
    colliders: new Colliders(data.colliders),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

function toGeometry(buffers, withFacade = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.color, 3));
  if (withFacade) geometry.setAttribute('facade', new THREE.BufferAttribute(buffers.facade, 3));
  geometry.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Standard PBR material with procedural windows. The "facade" attribute holds
 * (bays along the wall, floors up the wall, flag); flag 1 = draw windows, 0.5 = plain wall, 0 = roof.
 */
function createBuildingMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 facade;\nvarying vec3 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacade;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float windowMask = 0.0;
        if (vFacade.z > 0.75) {
          vec2 cell = vFacade.xy;
          vec2 f = fract(cell);
          vec2 w = fwidth(cell);
          vec2 lo = vec2(0.2, 0.3);
          vec2 hi = vec2(0.8, 0.85);
          vec2 m = smoothstep(lo - w, lo + w, f) * (1.0 - smoothstep(hi - w, hi + w, f));
          // Fade the pattern out where it would alias, darkening the wall to the pattern's average instead.
          float fade = smoothstep(0.2, 0.55, max(w.x, w.y));
          windowMask = m.x * m.y * (1.0 - fade);
          vec3 glass = vec3(0.025, 0.035, 0.05);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowMask);
          diffuseColor.rgb *= mix(1.0, 0.72, fade);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, windowMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.5, windowMask);');
  };
  return material;
}

function createTrees(data, track) {
  const count = data.length / 4;
  const group = new THREE.Group();
  if (!count) return group;

  const trunkGeometry = track(new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0));
  const crownGeometry = track(new THREE.IcosahedronGeometry(1, 1));
  const trunkMaterial = track(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }));
  const crownMaterial = track(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }));

  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < count; i++) {
    const x = data[i * 4], z = data[i * 4 + 1], s = data[i * 4 + 2], v = data[i * 4 + 3];
    quaternion.setFromAxisAngle(up, v * Math.PI * 2);

    matrix.compose(position.set(x, 0, z), quaternion, scale.set(s, 3.2 * s, s));
    trunks.setMatrixAt(i, matrix);

    matrix.compose(position.set(x, 4.4 * s, z), quaternion, scale.set(2.6 * s, 2.9 * s, 2.6 * s));
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, colour.setHSL(0.24 + v * 0.08, 0.45 + v * 0.15, 0.2 + v * 0.1));
  }

  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
