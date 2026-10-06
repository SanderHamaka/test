import * as THREE from 'three';
import { Colliders } from './Colliders.js';
import { createGridSampler } from './terrain.js';
import { COVER_SIZE, WATER_COLOUR } from './groundPainter.js';

const TREE_CELL = 12;

/** Materials and geometries shared by every tile, created once per game. */
export class TileResources {
  /** @param uniforms shared uniforms, e.g. { night } from Lighting */
  constructor(renderer, prepareMaterial, uniforms) {
    this.prepareMaterial = prepareMaterial;
    this.uniforms = uniforms;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.time = { value: 0 };

    this.buildingMaterial = prepareMaterial(createBuildingMaterial(uniforms));
    this.bridgeMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.flatGroundMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ color: 0xa5a98c, roughness: 1 }));

    // Street lamps: pole, glowing head and a pool of light on the ground, shared by all tiles.
    this.poleGeometry = new THREE.CylinderGeometry(0.07, 0.11, 6.2, 6).translate(0, 3.1, 0);
    this.headGeometry = new THREE.BoxGeometry(0.55, 0.16, 0.32).translate(0, 6.25, 0);
    this.poolGeometry = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.3, 0);
    this.poleMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.4 }));
    this.headMaterial = prepareMaterial(new THREE.MeshStandardMaterial({ color: 0xd8d2c0, emissive: 0xffc98a, emissiveIntensity: 0 }));
    this.poolMaterial = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(), color: 0xffb870, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });

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
    const material = this.prepareMaterial(createTerrainMaterial(texture, this.time, this.uniforms));
    return { material, owned: [material, texture] };
  }

  /** Street lights come on at dusk. */
  setNight(night) {
    this.headMaterial.emissiveIntensity = night * 6;
    this.poolMaterial.opacity = night * 0.55;
    this.poolMaterial.visible = night > 0.03;
  }

  dispose() {
    this.poolMaterial.map.dispose();
    for (const item of [
      this.poleGeometry, this.headGeometry, this.poolGeometry, this.poleMaterial, this.headMaterial, this.poolMaterial,
      this.buildingMaterial, this.bridgeMaterial, this.flatGroundMaterial,
      this.trunkGeometry, this.crownGeometry, this.trunkMaterial, this.crownMaterial,
    ]) item.dispose();
  }
}

/** Scene objects, collision data and ground heights for one built tile. */
export class Tile {
  constructor(data, resources) {
    this.rect = data.rect;
    this.colliders = new Colliders(data.colliders);
    this.groundAt = createGridSampler(data.rect, data.heights);
    this.stats = data.stats;
    this.food = data.food ?? new Float32Array(0);
    this.landmarks = data.landmarks ?? [];
    this.cover = data.cover ?? null;
    this.routes = data.routes ?? [];
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
    if (data.lamps?.length) this.addLamps(data.lamps, data.center, resources);
    this.indexTrees(data.trees, data.center);
  }

  /** Spatial grid of tree crowns (world coordinates) for "is the bird flying through a tree?" checks. */
  indexTrees(data, [cx, cz]) {
    this.crowns = [];
    this.crownGrid = new Map();
    for (let i = 0; i < data.length; i += 5) {
      const s = data[i + 3];
      const crown = { x: data[i] + cx, y: data[i + 1] + 4.4 * s, z: data[i + 2] + cz, r: 2.4 * s, h: 2.7 * s };
      this.crowns.push(crown);
      const key = `${Math.floor(crown.x / TREE_CELL)},${Math.floor(crown.z / TREE_CELL)}`;
      if (!this.crownGrid.has(key)) this.crownGrid.set(key, []);
      this.crownGrid.get(key).push(crown);
    }
  }

  /** Land cover at a point (see COVER in groundPainter.js), or 0 (built-up) when unknown. */
  coverAt(x, z) {
    if (!this.cover) return 0;
    const r = this.rect;
    const i = Math.min(COVER_SIZE - 1, Math.max(0, Math.floor(((x - r.minX) / (r.maxX - r.minX)) * COVER_SIZE)));
    const j = Math.min(COVER_SIZE - 1, Math.max(0, Math.floor(((z - r.minZ) / (r.maxZ - r.minZ)) * COVER_SIZE)));
    return this.cover[j * COVER_SIZE + i];
  }

  /** Number of tree crowns within `radius` metres of a point (horizontally), up to `max`. */
  treesNear(x, z, radius, max = 50) {
    let count = 0;
    const cells = Math.ceil(radius / TREE_CELL);
    const gx = Math.floor(x / TREE_CELL), gz = Math.floor(z / TREE_CELL);
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dz = -cells; dz <= cells; dz++) {
        for (const c of this.crownGrid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (Math.hypot(x - c.x, z - c.z) < radius && ++count >= max) return count;
        }
      }
    }
    return count;
  }

  /** The tree crown containing a point, or null. */
  treeAt(x, y, z) {
    const gx = Math.floor(x / TREE_CELL), gz = Math.floor(z / TREE_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const c of this.crownGrid.get(`${gx + dx},${gz + dz}`) ?? []) {
          const horizontal = Math.hypot(x - c.x, z - c.z) / c.r;
          const vertical = (y - c.y) / c.h;
          if (horizontal * horizontal + vertical * vertical < 1) return c;
        }
      }
    }
    return null;
  }

  own(item) {
    this.owned.push(item);
    return item;
  }

  addLamps(data, [cx, cz], resources) {
    const count = data.length / 3;
    const parts = [
      [resources.poleGeometry, resources.poleMaterial, true],
      [resources.headGeometry, resources.headMaterial, false],
      [resources.poolGeometry, resources.poolMaterial, false],
    ];
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [geometry, material, shadows] of parts) {
      const mesh = this.own(new THREE.InstancedMesh(geometry, material, count));
      for (let i = 0; i < count; i++) {
        rotation.setFromAxisAngle(up, (data[i * 3] * 7.1 + data[i * 3 + 2] * 3.3) % (Math.PI * 2));
        matrix.compose(new THREE.Vector3(data[i * 3] - cx, data[i * 3 + 1], data[i * 3 + 2] - cz), rotation, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, matrix);
      }
      mesh.castShadow = shadows;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
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
 * Standard PBR material with procedural windows. The "facade" attribute holds (bays along the wall,
 * floors up the wall, flag); flag 0 = roof, 0.5 = plain wall, 1 + n = a wall with n window rows.
 * Each building picks a window style from its colour; at night a random share of windows is lit.
 */
function createBuildingMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.night = uniforms.night;
    shader.uniforms.wet = uniforms.wet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 facade;\nvarying vec3 vFacade;\nvarying vec3 vWallNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;\nvWallNormal = normal;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFacade;
        varying vec3 vWallNormal;
        uniform float night;
        uniform float wet;
        float hash1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float windowMask = 0.0;
        float windowLit = 0.0;
        float windowFade = 0.0;
        if (vFacade.z > 0.75) {
          vec2 cell = vFacade.xy;
          vec2 f = fract(cell);
          vec2 w = fwidth(cell);
          // Hash inputs are rounded: interpolated varyings differ slightly per pixel, and a hash
          // would turn those tiny differences into a different style for every pixel.
          vec3 buildingId = floor(vColor.rgb * 1023.0 + 0.5);
          float style = hash1(buildingId * 0.137);
          // Classic punched windows, tall narrow ones, or wide ribbon windows.
          vec2 lo = style < 0.4 ? vec2(0.2, 0.3) : style < 0.75 ? vec2(0.3, 0.16) : vec2(0.06, 0.34);
          vec2 hi = style < 0.4 ? vec2(0.8, 0.85) : style < 0.75 ? vec2(0.7, 0.9) : vec2(0.94, 0.8);
          vec2 m = smoothstep(lo - w, lo + w, f) * (1.0 - smoothstep(hi - w, hi + w, f));
          vec2 frameLo = lo - 0.05, frameHi = hi + 0.05;
          vec2 fm = smoothstep(frameLo - w, frameLo + w, f) * (1.0 - smoothstep(frameHi - w, frameHi + w, f));
          // Fade the pattern out where it would alias, darkening the wall to the pattern's average instead.
          windowFade = smoothstep(0.2, 0.55, max(w.x, w.y));
          // Only window rows that fit between the ground floor and the eaves (flag = 1 + rows).
          float rowFits = step(0.0, cell.y) * step(floor(cell.y) + 1.0, vFacade.z - 1.0 + 0.2);
          float detail = (1.0 - windowFade) * rowFits;
          windowFade *= rowFits; // gables above the eaves have no windows, near or far
          windowMask = m.x * m.y * detail;
          // Frames are thin: only draw them while they're several pixels wide, or they sparkle.
          float frame = (fm.x * fm.y - m.x * m.y) * detail * (1.0 - smoothstep(0.03, 0.07, max(w.x, w.y)));
          float wallId = dot(buildingId, vec3(0.17, 0.59, 0.83)) + dot(floor(vWallNormal.xz * 8.0 + 0.5), vec2(3.1, 5.7));
          windowLit = step(hash1(vec3(floor(cell), wallId)), 0.38);
          vec3 glass = vec3(0.025, 0.035, 0.05);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.74, 0.7), frame * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowMask);
          diffuseColor.rgb *= mix(1.0, 0.72, windowFade);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, windowMask) * mix(1.0, 0.45, wet);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.5, windowMask);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vFacade.z > 0.75) {
          vec3 warm = vec3(1.0, 0.72, 0.42);
          // Up close: individual lit windows. Far away: the average glow of a lit facade.
          float glow = windowLit * windowMask + 0.07 * windowFade;
          totalEmissiveRadiance += warm * glow * night * 1.1;
        }`);
  };
  return material;
}

const WATER_LINEAR = new THREE.Color(WATER_COLOUR); // THREE.Color converts the sRGB hex to linear

/**
 * Terrain with the painted ground texture. Pixels in the exact water colour become glossy,
 * gently rippling water that reflects the sky.
 */
function createTerrainMaterial(texture, time, uniforms) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.night = uniforms.night;
    shader.uniforms.wet = uniforms.wet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    const w = WATER_LINEAR;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;\nuniform float waterTime;\nuniform float night;\nuniform float wet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        const vec3 waterColour = vec3(${w.r.toFixed(5)}, ${w.g.toFixed(5)}, ${w.b.toFixed(5)});
        float waterMask = 1.0 - smoothstep(0.02, 0.06, distance(diffuseColor.rgb, waterColour));
        diffuseColor.rgb = mix(diffuseColor.rgb, waterColour * 0.75, waterMask);
        // Asphalt is a dark neutral grey: give it a faint sodium street-light glow at night.
        vec3 c = diffuseColor.rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        float roadMask = (1.0 - smoothstep(0.012, 0.03, sat)) * smoothstep(0.03, 0.045, lum) * (1.0 - smoothstep(0.13, 0.17, lum)) * (1.0 - waterMask);
        // Rain darkens the ground a little and makes paved surfaces shiny.
        diffuseColor.rgb *= mix(1.0, 0.82, wet * (1.0 - waterMask));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * roadMask * night * 0.015;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.25 + 0.55 * (1.0 - roadMask), wet), 0.05, waterMask);')
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

/** Soft round light pool, bright in the middle. */
function lightPoolTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
