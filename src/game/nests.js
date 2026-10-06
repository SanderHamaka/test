import * as THREE from 'three';
import { createBranchGeometry } from './birdModel.js';
import { buildNestGeometry } from './nestModel.js';

const MERGE_RADIUS = 2; // a branch dropped this close to a nest is added to it
const VISIBLE_DISTANCE = 6000;
const MAX_BRANCHES = 400;

/** Nest sizes worth celebrating. The first one turns a pile of twigs into your home. */
export const NEST_MILESTONES = [
  { branches: 5, name: 'Nest', xp: 40, text: 'Your nest is finished! It’s now your home: you’ll start here.' },
  { branches: 15, name: 'Cosy nest', xp: 60, text: 'A cosy nest! The neighbours are jealous.' },
  { branches: 30, name: 'Grand nest', xp: 100, text: 'A grand nest, visible from three roofs away.' },
  { branches: 60, name: 'Legendary nest', xp: 200, text: 'A legendary nest. Storks come to take notes.' },
];

/** Which model a nest shows: loose twigs until it's finished, then ever bigger nests. */
export const NEST_STAGES = [
  { branches: 5, size: 'small' },
  { branches: 15, size: 'large' },
  { branches: 30, size: 'huge' },
  { branches: 60, size: 'legendary' },
];

const stageOf = (branches) => NEST_STAGES.findLast((s) => branches >= s.branches)?.size ?? null;

const POP_SECONDS = 0.7;
// Overshoots a little, then settles: the nest "puffs up" into its new size.
const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

const hash = (i, salt) => {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Nests built from branches. They're saved in Progress by latitude/longitude and absolute elevation,
 * so they stay where you built them whichever place you start from.
 */
export class Nests {
  /**
   * @param projection  the world's local projection (lat/lon ↔ metres)
   * @param originElevation  absolute elevation of the world origin, to convert stored heights
   */
  constructor(scene, prepareMaterial, progress, projection, originElevation) {
    this.scene = scene;
    this.progress = progress;
    this.projection = projection;
    this.originElevation = originElevation;
    this.geometry = createBranchGeometry(1.2);
    this.material = prepareMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.meshes = new Map(); // nest id → InstancedMesh of loose twigs (before a nest is finished)
    this.models = new Map(); // nest id → { mesh, size, pop }
    this.geometries = new Map(); // size → shared nest geometry
    for (const nest of progress.nests) this.refresh(nest, false);
  }

  /** A nest's position in this world's local coordinates. */
  localPosition(nest) {
    const [x, z] = this.projection.toLocal(nest.lat, nest.lon);
    return new THREE.Vector3(x, nest.elevation - this.originElevation, z);
  }

  /**
   * Drops a branch at a spot (the surface the bird landed on). Joins a nest within 2 m or starts a new one.
   * @returns { nest, created, milestone }
   */
  addBranch(x, y, z) {
    let nest = null;
    for (const candidate of this.progress.nests) {
      const p = this.localPosition(candidate);
      if (Math.hypot(p.x - x, p.z - z) < MERGE_RADIUS && Math.abs(p.y - y) < MERGE_RADIUS) nest = candidate;
    }
    const created = !nest;
    if (!nest) {
      const [lat, lon] = this.projection.toLatLon(x, z);
      nest = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, lat, lon, elevation: y + this.originElevation, branches: 0 };
      this.progress.nests.push(nest);
    }
    nest.branches = Math.min(MAX_BRANCHES, nest.branches + 1);
    this.progress.save();
    this.refresh(nest);
    return { nest, created, milestone: NEST_MILESTONES.find((m) => m.branches === nest.branches) ?? null };
  }

  /** The biggest finished nest within `range` metres of a point: your home there. */
  homeNear(point, range = 3000) {
    let best = null;
    for (const nest of this.progress.nests) {
      if (nest.branches < NEST_MILESTONES[0].branches) continue;
      const p = this.localPosition(nest);
      if (Math.hypot(p.x - point.x, p.z - point.z) > range) continue;
      if (!best || nest.branches > best.nest.branches) best = { nest, position: p };
    }
    return best;
  }

  /** Shows a nest: loose twigs until it's finished, then the model for its size (popping into place when it grows). */
  refresh(nest, animate = true) {
    const position = this.localPosition(nest);
    if (Math.hypot(position.x, position.z) > VISIBLE_DISTANCE) return;
    const size = stageOf(nest.branches);
    if (!size) {
      this.refreshTwigs(nest, position);
      return;
    }

    // Finished: the loose twigs make way for a real nest.
    const twigs = this.meshes.get(nest.id);
    if (twigs) {
      twigs.removeFromParent();
      twigs.dispose();
      this.meshes.delete(nest.id);
    }
    let model = this.models.get(nest.id);
    if (model?.size === size) return;
    if (!this.geometries.has(size)) this.geometries.set(size, buildNestGeometry(size));
    if (!model) {
      const mesh = new THREE.Mesh(this.geometries.get(size), this.material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.copy(position);
      mesh.rotation.y = hash(1, nest.lat * 1000 + nest.lon) * Math.PI * 2; // each nest turned its own way
      this.scene.add(mesh);
      model = { mesh, size, pop: 0 };
      this.models.set(nest.id, model);
    }
    model.mesh.geometry = this.geometries.get(size);
    model.size = size;
    model.pop = animate ? POP_SECONDS : 0;
    model.mesh.scale.setScalar(animate ? 0.6 : 1);
  }

  /** Grow animation for nests that just changed size. */
  update(dt) {
    for (const model of this.models.values()) {
      if (model.pop <= 0) continue;
      model.pop = Math.max(0, model.pop - dt);
      model.mesh.scale.setScalar(0.6 + 0.4 * easeOutBack(1 - model.pop / POP_SECONDS));
    }
  }

  /** Loose twigs for an unfinished nest. Each twig's place depends only on its own index, so the pile
   *  grows without existing twigs moving. */
  refreshTwigs(nest, position) {
    let mesh = this.meshes.get(nest.id);
    if (!mesh || mesh.instanceMatrix.count < nest.branches) {
      mesh?.removeFromParent();
      mesh?.dispose();
      mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(16, nest.branches * 2));
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.set(nest.id, mesh);
    }
    mesh.position.copy(position);

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const offset = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nest.branches; i++) {
      const angle = i * 2.39996; // golden angle: an even spread around the nest
      const radius = 0.12 + 0.1 * Math.sqrt(i) * (0.85 + 0.3 * hash(i, 1));
      const height = Math.min(0.06 * Math.sqrt(i), 1.4) + 0.03 * hash(i, 2);
      offset.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      // Lie roughly along the rim (tangent), woven with a little random tilt.
      euler.set((hash(i, 3) - 0.5) * 0.5, -angle + (hash(i, 4) - 0.5) * 0.9, (hash(i, 5) - 0.5) * 0.4);
      scale.setScalar(0.85 + 0.4 * hash(i, 6));
      matrix.compose(offset, rotation.setFromEuler(euler), scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = nest.branches;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  dispose() {
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    for (const { mesh } of this.models.values()) mesh.removeFromParent();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
