import * as THREE from 'three';
import { Colliders } from './Colliders.js';
import { createGridSampler } from './terrain.js';
import { WATER_COLOUR } from './groundPainter.js';

/** Materials and geometries shared by every tile, created once per game. */
export class TileResources {
  constructor(renderer, prepareMaterial) {
    this.prepareMaterial = prepareMaterial;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.time = { value: 0 };

    this.buildingMaterial = prepareMaterial(createBuildingMaterial());
    this.bridgeMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.flatGroundMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ color: 0xa5a98c, roughness: 1 }));

    this.trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0);
    this.crownGeometry = new THREE.IcosahedronGeometry(1, 1);
    this.trunkMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }));
    this.crownMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }));
  }

  terrainMaterial(groundBitmap) {
    if (!groundBitmap) return { material: this.flatGroundMaterial, owned: [] };
    const texture = new THREE.Texture(groundBitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = this.anisotropy;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    const material = this.prepareMaterial(createTerrainMaterial(texture, this.time));
    return { material, owned: [material, texture] };
  }

  dispose() {
    for (const item of [
      this.buildingMaterial, this.bridgeMaterial, this.flatGroundMaterial,
      this.trunkGeometry, this.crownGeometry, this.trunkMaterial, this.crownMaterial,
    ]) item.dispose();
  }
}

/** Scene objects, collision data and ground heights for one built tile. */
export class Tile {
  constructor(data, resources) {
    this.rect = data.rect;
    this.flatTerrain = data.flatTerrain;
    this.colliders = new Colliders(data.colliders);
    this.groundAt = createGridSampler(data.rect, data.heights);
    this.stats = data.stats;
    this.owned = [];

    const group = new THREE.Group();
    group.position.set(data.center[0], 0, data.center[1]);
    this.group = group;

    const { material, owned } = resources.terrainMaterial(data.ground);
    this.owned.push(...owned);
    const terrain = new THREE.Mesh(this.own(geometry(data.terrain)), material);
    terrain.receiveShadow = true;
    group.add(terrain);

    if (data.buildings.index.length) {
      const g = this.own(geometry(data.buildings));
      g.setAttribute('facade', new THREE.BufferAttribute(data.buildings.facade, 3));
      const mesh = new THREE.Mesh(g, resources.buildingMaterial);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }

    if (data.bridges.index.length) {
      const mesh = new THREE.Mesh(this.own(geometry(data.bridges)), resources.bridgeMaterial);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }

    if (data.trees.length) this.addTrees(data.trees, resources);
  }

  own(item) {
    this.owned.push(item);
    return item;
  }

  addTrees(data, resources) {
    const count = data.length / 5;
    const trunks = this.own(new THREE.InstancedMesh(resources.trunkGeometry, resources.trunkMaterial, count));
    const crowns = this.own(new THREE.InstancedMesh(resources.crownGeometry, resources.crownMaterial, count));
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const colour = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const [x, y, z, s, v] = data.subarray(i * 5, i * 5 + 5);
      quaternion.setFromAxisAngle(up, v * Math.PI * 2);
      matrix.compose(position.set(x, y - 0.2, z), quaternion, scale.set(s, 3.2 * s, s));
      trunks.setMatrixAt(i, matrix);
      matrix.compose(position.set(x, y + 4.4 * s, z), quaternion, scale.set(2.6 * s, 2.9 * s, 2.6 * s));
      crowns.setMatrixAt(i, matrix);
      crowns.setColorAt(i, colour.setHSL(0.24 + v * 0.08, 0.45 + v * 0.15, 0.2 + v * 0.1));
    }
    for (const mesh of [trunks, crowns]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  contains(x, z, margin = 0) {
    const r = this.rect;
    return x >= r.minX - margin && x < r.maxX + margin && z >= r.minZ - margin && z < r.maxZ + margin;
  }

  dispose() {
    this.group.removeFromParent();
    for (const item of this.owned) {
      if (item.isTexture) item.image?.close?.(); // free the ImageBitmap's memory now, not at garbage collection
      item.dispose();
    }
  }
}

function geometry(buffers) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
  if (buffers.color) g.setAttribute('color', new THREE.BufferAttribute(buffers.color, 3));
  if (buffers.uv) g.setAttribute('uv', new THREE.BufferAttribute(buffers.uv, 2));
  g.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  g.computeBoundingSphere();
  return g;
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
          windowMask = m.x * m.y * (1.0 - fade) * step(0.0, cell.y);
          vec3 glass = vec3(0.025, 0.035, 0.05);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowMask);
          diffuseColor.rgb *= mix(1.0, 0.72, fade);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, windowMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.5, windowMask);');
  };
  return material;
}

const WATER_LINEAR = new THREE.Color(WATER_COLOUR); // THREE.Color converts the sRGB hex to linear

/**
 * Terrain with the painted ground texture. Pixels in the exact water colour become glossy,
 * gently rippling water that reflects the sky.
 */
function createTerrainMaterial(texture, time) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    const w = WATER_LINEAR;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;\nuniform float waterTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        const vec3 waterColour = vec3(${w.r.toFixed(5)}, ${w.g.toFixed(5)}, ${w.b.toFixed(5)});
        float waterMask = 1.0 - smoothstep(0.02, 0.06, distance(diffuseColor.rgb, waterColour));
        diffuseColor.rgb = mix(diffuseColor.rgb, waterColour * 0.75, waterMask);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.05, waterMask);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (waterMask > 0.0) {
          vec2 p = vWaterWorld.xz;
          float t = waterTime;
          vec2 slope = vec2(
            sin(p.x * 0.35 + t * 1.1) * 0.6 + sin(p.x * 0.9 + p.y * 0.4 - t * 1.7) * 0.4 + sin(p.y * 1.7 + t * 2.3) * 0.2,
            cos(p.y * 0.31 - t * 0.9) * 0.6 + sin(p.y * 1.1 - p.x * 0.5 + t * 1.5) * 0.4 + cos(p.x * 1.9 - t * 2.1) * 0.2);
          // Fade ripples out where they're smaller than a pixel, or they alias into stripes.
          float rippleFade = 1.0 - smoothstep(0.4, 1.6, length(fwidth(p)));
          vec3 ripple = (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xyz * 0.05 * rippleFade;
          normal = normalize(normal + ripple * waterMask);
        }`);
  };
  return material;
}
