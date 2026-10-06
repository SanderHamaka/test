import { bboxAround, createProjection } from './geo.js';
import { fetchOverpass } from './overpass.js';
import { parseOsm } from './osmParse.js';
import { buildWorld } from './meshBuilder.js';
import { generateDemoCity } from './demoCity.js';

/**
 * Loads OSM data for a place and turns it into mesh buffers, off the main thread.
 * In:  { lat, lon, radius, demo }
 * Out: { type: 'progress', message } ... then { type: 'done', world } or { type: 'error', message }
 */
self.onmessage = async ({ data: { lat, lon, radius, demo } }) => {
  const progress = (message) => self.postMessage({ type: 'progress', message });

  try {
    let osm;
    if (demo) {
      progress('Generating demo city…');
      osm = generateDemoCity();
    } else {
      progress('Downloading map data from OpenStreetMap…');
      osm = await fetchOverpass(bboxAround(lat, lon, radius), (bytes) => {
        progress(`Downloading map data from OpenStreetMap… ${(bytes / 1048576).toFixed(1)} MB`);
      });
    }

    progress(`Reading ${osm.elements.length.toLocaleString()} map features…`);
    const features = parseOsm(osm.elements, createProjection(lat, lon));

    progress(`Building ${features.buildings.length.toLocaleString()} buildings in 3D…`);
    const world = buildWorld(features, radius);

    self.postMessage({ type: 'done', world }, collectBuffers(world));
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message ?? String(error) });
  }
};

function collectBuffers(value, out = []) {
  if (ArrayBuffer.isView(value)) out.push(value.buffer);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectBuffers(v, out));
  return out;
}
