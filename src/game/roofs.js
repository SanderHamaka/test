/**
 * Roof shapes for extruded buildings. Footprints are arbitrary polygons, so roofs are fitted to the
 * footprint's oriented bounding box: a gabled roof is two planes meeting at a ridge through the box,
 * a pyramidal roof rises to the box centre.
 */

export const FLAT = 0;
export const GABLED = 1;
export const PYRAMIDAL = 2;

const GABLED_TAGS = new Set(['gabled', 'gambrel', 'saltbox', 'half-hipped', 'mansard', 'hipped', 'side_hipped', 'round']);
const PYRAMIDAL_TAGS = new Set(['pyramidal', 'dome', 'onion', 'cone']);
const HOUSE_TYPES = /^(house|detached|semidetached_house|terrace|bungalow|farm|barn|farm_auxiliary|stable|cowshed|church|chapel)$/;

/** Smallest-area bounding rectangle of a ring, tried along each edge direction. */
export function orientedBox(ring) {
  let best = null;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    let ux = ring[i] - ring[j], uz = ring[i + 1] - ring[j + 1];
    const len = Math.hypot(ux, uz);
    if (len < 0.5) continue;
    ux /= len;
    uz /= len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let k = 0; k < ring.length; k += 2) {
      const u = ring[k] * ux + ring[k + 1] * uz;
      const v = -ring[k] * uz + ring[k + 1] * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV };
  }
  if (!best) return null;

  // Express the box as centre + long axis (r) + short axis (p).
  const du = best.maxU - best.minU, dv = best.maxV - best.minV;
  const cu = (best.minU + best.maxU) / 2, cv = (best.minV + best.maxV) / 2;
  const cx = cu * best.ux - cv * best.uz;
  const cz = cu * best.uz + cv * best.ux;
  const along = du >= dv;
  return {
    area: best.area,
    cx, cz,
    rx: along ? best.ux : -best.uz, rz: along ? best.uz : best.ux, // long axis
    length: Math.max(du, dv),
    width: Math.min(du, dv),
  };
}

/**
 * Picks the roof for a building. Returns { shape, height, ridgeAlongLong } or a flat roof.
 * Untagged houses get gabled roofs; narrow terraced houses get their ridge across the short side,
 * parallel to the street, as is usual in the Netherlands and much of Europe.
 */
export function chooseRoof(tags, type, area, box, rings, measuredSlanted) {
  const tagged = tags['roof:shape'];
  let shape = FLAT;
  if (tagged) shape = GABLED_TAGS.has(tagged) ? GABLED : PYRAMIDAL_TAGS.has(tagged) ? PYRAMIDAL : FLAT;
  else if (measuredSlanted != null) shape = measuredSlanted ? GABLED : FLAT;
  else if (HOUSE_TYPES.test(type) || ((type === 'yes' || type === 'residential') && area > 25 && area < 300 && !tags['building:levels'])) {
    shape = GABLED;
  }
  if (shape === FLAT || !box) return { shape: FLAT, height: 0 };

  // Fitted roofs only make sense on fairly rectangular footprints without courtyards.
  const rectangularity = area / box.area;
  if (rings.length > 1 || rectangularity < 0.75) return { shape: FLAT, height: 0 };
  if (shape === PYRAMIDAL && (rectangularity < 0.85 || box.length / box.width > 1.5)) shape = GABLED;

  const aspect = box.length / Math.max(box.width, 0.1);
  let ridgeAlongLong = true;
  if (tags['roof:orientation'] === 'across') ridgeAlongLong = false;
  else if (!tags['roof:orientation'] && (type === 'terrace' || (box.width < 7.5 && aspect > 1.25 && area < 160))) {
    ridgeAlongLong = false;
  }

  const span = shape === PYRAMIDAL ? box.width : ridgeAlongLong ? box.width : box.length;
  const height = Math.min(Math.max(span * 0.42, 1.5), 9);
  return { shape, height, ridgeAlongLong };
}

/**
 * Roof geometry parameters in world terms, shared by mesh building and collision:
 * { shape, eave, height, ox, oz, px, pz, halfA, halfB }. For a gabled roof (o, p) is the ridge line and
 * its normal, halfA half the span. For a pyramid o is the apex, p the short axis, halfA/halfB half-sizes.
 */
export function roofFrame(roof, box, eave) {
  if (roof.shape === FLAT) return { shape: FLAT, eave, height: 0 };
  // p points across the ridge.
  const [px, pz] = roof.shape === PYRAMIDAL || roof.ridgeAlongLong ? [-box.rz, box.rx] : [box.rx, box.rz];
  const halfA = (roof.shape === PYRAMIDAL || roof.ridgeAlongLong ? box.width : box.length) / 2;
  const halfB = (roof.shape === PYRAMIDAL || roof.ridgeAlongLong ? box.length : box.width) / 2;
  return { shape: roof.shape, eave, height: roof.height, ox: box.cx, oz: box.cz, px, pz, halfA, halfB };
}

/** Roof surface height above (x, z) for a frame from roofFrame. */
export function roofHeightAt(f, x, z) {
  if (f.shape === FLAT) return f.eave;
  const dx = x - f.ox, dz = z - f.oz;
  const a = Math.abs(dx * f.px + dz * f.pz) / f.halfA;
  if (f.shape === GABLED) return f.eave + f.height * Math.max(0, 1 - a);
  const b = Math.abs(-dx * f.pz + dz * f.px) / f.halfB;
  return f.eave + f.height * Math.max(0, 1 - Math.max(a, b));
}

/** Inserts a vertex wherever a ring edge crosses the ridge line, so walls can follow the gable. */
export function splitRingAtRidge(ring, f) {
  if (f.shape !== GABLED) return ring;
  const side = (i) => (ring[i] - f.ox) * f.px + (ring[i + 1] - f.oz) * f.pz;
  const out = [];
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    out.push(ring[i], ring[i + 1]);
    const a = side(i), b = side(j);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const t = a / (a - b);
      out.push(ring[i] + (ring[j] - ring[i]) * t, ring[i + 1] + (ring[j + 1] - ring[i + 1]) * t);
    }
  }
  return out;
}

/** The part of a ring on one side of the ridge (sign +1 or -1), by Sutherland–Hodgman clipping. */
export function clipRingToSide(ring, f, sign) {
  const side = (i) => sign * ((ring[i] - f.ox) * f.px + (ring[i + 1] - f.oz) * f.pz);
  const out = [];
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const a = side(i), b = side(j);
    if (a >= 0) out.push(ring[i], ring[i + 1]);
    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      out.push(ring[i] + (ring[j] - ring[i]) * t, ring[i + 1] + (ring[j + 1] - ring[i + 1]) * t);
    }
  }
  return out.length >= 6 ? out : null;
}
