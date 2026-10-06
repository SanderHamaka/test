import * as THREE from 'three';
import { animateBird, buildBirdModel } from './birdModel.js';

const cache = new Map();

/**
 * Renders a three-quarter portrait of each species (wings spread, mid-glide) to image URLs for the
 * album. Uses one temporary renderer for all of them.
 */
export function renderPortraits(speciesList, size = 360) {
  const missing = speciesList.filter((s) => !cache.has(s.id));
  if (missing.length) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      return Object.fromEntries(speciesList.map((s) => [s.id, null])); // no WebGL: the album shows initials
    }
    renderer.setSize(size, size);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a7a66, 1.6));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    key.position.set(2, 3, 2);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    for (const species of missing) {
      const { root, rig } = buildBirdModel(species.look);
      animateBird(rig, { phase: 1.2, flap: 0.35, tuck: 0, perch: 0, headTurn: -0.25, tailSpread: 0.4 });
      root.rotation.set(0.12, Math.PI * 0.78, -0.1);
      scene.add(root);

      // Frame the bird: fit its bounding sphere in view.
      const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
      const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92;
      camera.position.copy(sphere.center).add(new THREE.Vector3(0.35, 0.45, 1).normalize().multiplyScalar(distance));
      camera.lookAt(sphere.center);

      renderer.render(scene, camera);
      cache.set(species.id, renderer.domElement.toDataURL('image/png'));
      scene.remove(root);
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return Object.fromEntries(speciesList.map((s) => [s.id, cache.get(s.id)]));
}
