import { createProjection } from './geo.js';

/**
 * A small generated city in Overpass JSON format, so the full pipeline can run without network access.
 * Layout: a grid of blocks with buildings, a park with trees and a canal along the southern edge.
 */
export const DEMO_PLACE = { name: 'Demo City', lat: 52.0907, lon: 5.1214 };

export function generateDemoCity() {
  const proj = createProjection(DEMO_PLACE.lat, DEMO_PLACE.lon);
  const geometry = (points) => points.map(([x, z]) => {
    const [lat, lon] = proj.toLatLon(x, z);
    return { lat, lon };
  });
  const closed = (points) => geometry([...points, points[0]]);
  const rect = (x, z, w, d) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];

  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const elements = [];
  let id = 1;

  const block = 90;
  const street = 16;
  const extent = 4;

  for (let bx = -extent; bx < extent; bx++) {
    for (let bz = -extent; bz < extent; bz++) {
      const x0 = bx * (block + street) + street / 2;
      const z0 = bz * (block + street) + street / 2;

      if (bx === 1 && (bz === -1 || bz === -2)) {
        elements.push({ type: 'way', id: id++, tags: { leisure: 'park' }, geometry: closed(rect(x0, z0, block, block)) });
        continue;
      }

      const downtown = Math.abs(bx) + Math.abs(bz) < 3;
      const lots = 3;
      const lot = block / lots;
      for (let i = 0; i < lots; i++) {
        for (let j = 0; j < lots; j++) {
          if (i === 1 && j === 1) continue; // courtyard
          const levels = downtown ? 6 + Math.floor(random() * 22) : 2 + Math.floor(random() * 5);
          elements.push({
            type: 'way',
            id: id++,
            tags: { building: downtown ? 'office' : 'apartments', 'building:levels': String(levels) },
            geometry: closed(rect(x0 + i * lot + 1.5, z0 + j * lot + 1.5, lot - 3, lot - 3)),
          });
        }
      }
    }
  }

  const span = extent * (block + street);
  for (let k = -extent; k <= extent; k++) {
    const c = k * (block + street);
    elements.push({ type: 'way', id: id++, tags: { highway: k === 0 ? 'primary' : 'residential' }, geometry: geometry([[c, -span], [c, span]]) });
    elements.push({ type: 'way', id: id++, tags: { highway: k === 0 ? 'primary' : 'residential' }, geometry: geometry([[-span, c], [span, c]]) });
  }

  for (let t = 0; t < 40; t++) {
    const [lat, lon] = proj.toLatLon(-span + random() * span * 2, -span - 6);
    elements.push({ type: 'node', id: id++, lat, lon, tags: { natural: 'tree' } });
  }

  const canal = [];
  for (let x = -span - 200; x <= span + 200; x += 40) canal.push([x, span + 40 + Math.sin(x / 120) * 25]);
  elements.push({ type: 'way', id: id++, tags: { waterway: 'canal', width: '24' }, geometry: geometry(canal) });
  elements.push({
    type: 'way', id: id++, tags: { landuse: 'grass' },
    geometry: closed(rect(-span - 200, span + 8, (span + 200) * 2, 100)),
  });

  return { elements };
}
