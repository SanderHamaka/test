import { fetchJsonCached } from './cache.js';

/**
 * Measured building heights for the Netherlands from the 3D BAG (https://3dbag.nl, CC BY 4.0),
 * which derives every building's roof heights from the national aerial laser scan.
 *
 * OSM buildings in the Netherlands come from the same national register (BAG) and carry its id in
 * `ref:bag`, so the two can be joined exactly. Anything that goes wrong here just means the game
 * falls back to estimated heights.
 */

const WFS_URL = 'https://data.3dbag.nl/api/BAG3D/wfs';
const LAYER = 'BAG3D:pand';
const PAGE_SIZE = 5000;
const MAX_PAGES = 8;

// Attribute names in current 3D BAG releases, and the older names (before 2023) as a fallback.
const NAMES = {
  ground: ['b3_h_maaiveld', 'h_maaiveld'],
  roofMin: ['b3_h_dak_min', 'h_dak_min'],
  roof70: ['b3_h_dak_70p', 'h_dak_70p'],
  roofMax: ['b3_h_dak_max', 'h_dak_max'],
  roofType: ['b3_dak_type', 'dak_type'],
};

/** Rough outline of the Netherlands; the 3D BAG simply has no data for the bits of Belgium/Germany inside. */
export function inNetherlands({ south, west, north, east }) {
  const lat = (south + north) / 2, lon = (west + east) / 2;
  return lat > 50.7 && lat < 53.7 && lon > 3.2 && lon < 7.3;
}

/** Normalised BAG building id (digits without leading zeros), from either an OSM tag or a 3D BAG id. */
export function bagId(value) {
  const digits = String(value ?? '').match(/(\d+)\s*$/)?.[1];
  return digits ? digits.replace(/^0+/, '') : null;
}

/**
 * Measured heights within a bounding box: Map of BAG id → { top, eave, slanted } in metres above ground.
 */
export async function fetchBagHeights(bounds) {
  const heights = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const features = await fetchPage(bounds, page);
    for (const { properties: p } of features) {
      const id = bagId(p.identificatie);
      const measured = id && toMeasured(p);
      if (measured) heights.set(id, measured);
    }
    if (features.length < PAGE_SIZE) break;
  }
  return heights;
}

async function fetchPage({ south, west, north, east }, page) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: LAYER,
    outputFormat: 'application/json',
    // WFS 2.0 with an EPSG URN uses latitude-first axis order.
    bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`,
    count: String(PAGE_SIZE),
    startIndex: String(page * PAGE_SIZE),
    sortBy: 'identificatie',
  });
  const isFeatureCollection = (data) => {
    if (!Array.isArray(data?.features)) throw new Error('Unexpected 3D BAG response');
  };

  // Ask for just the attributes (no geometry) with a stable sort for paging. Older or differently
  // configured releases may reject attribute names or sorting, so fall back step by step.
  const properties = ['identificatie', ...Object.values(NAMES).map((n) => n[0])].join(',');
  const variants = [{ propertyName: properties }, { propertyName: properties, sortBy: null }, { sortBy: null }];
  let lastError;
  for (const variant of variants) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(variant)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    try {
      return (await fetchJsonCached(`${WFS_URL}?${query}`, isFeatureCollection)).features;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function pick(properties, names) {
  for (const name of names) {
    const value = properties[name];
    if (value != null && value !== '') return typeof value === 'number' ? value : parseFloat(value);
  }
  return NaN;
}

function toMeasured(p) {
  const ground = pick(p, NAMES.ground);
  const roofMax = pick(p, NAMES.roofMax);
  const roof70 = pick(p, NAMES.roof70);
  const roofMin = pick(p, NAMES.roofMin);
  const type = String(p[NAMES.roofType[0]] ?? p[NAMES.roofType[1]] ?? '');
  if (!Number.isFinite(ground)) return null;

  const slanted = type === 'slanted';
  // Slanted roofs: walls up to the lowest roof point, ridge at the highest. Flat roofs: the 70th
  // percentile, which the 3D BAG recommends for block models (ignores chimneys and installations).
  const top = (slanted ? roofMax : roof70) - ground;
  if (!Number.isFinite(top) || top < 1 || top > 400) return null;
  const eave = slanted && Number.isFinite(roofMin) ? Math.max(roofMin - ground, 1.5) : top;
  return { top, eave: Math.min(eave, top), slanted };
}
