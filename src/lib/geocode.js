/**
 * Place search on OpenStreetMap data.
 * Photon (komoot) supports search-as-you-type; Nominatim is only used as a fallback
 * on an explicit submit, because its usage policy forbids autocomplete.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function searchPlaces(query, { signal, allowNominatim = false } = {}) {
  try {
    return await searchPhoton(query, signal);
  } catch (error) {
    if (error.name === 'AbortError' || !allowNominatim) throw error;
    return searchNominatim(query, signal);
  }
}

async function searchPhoton(query, signal) {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=7`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Photon answered ${response.status}`);
  const { features } = await response.json();

  return features.map(({ geometry, properties: p }) => ({
    id: `${p.osm_type}${p.osm_id}`,
    name: p.name ?? p.street ?? p.city ?? 'Unnamed place',
    detail: unique([p.city, p.county, p.state, p.country]).filter((part) => part !== p.name).join(', '),
    type: p.osm_value?.replace(/_/g, ' '),
    lat: geometry.coordinates[1],
    lon: geometry.coordinates[0],
  }));
}

async function searchNominatim(query, signal) {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=7&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
  const results = await response.json();

  return results.map((r) => {
    const [name, ...rest] = r.display_name.split(', ');
    return {
      id: `${r.osm_type}${r.osm_id}`,
      name: r.name || name,
      detail: rest.slice(-3).join(', '),
      type: r.type?.replace(/_/g, ' '),
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    };
  });
}

const unique = (parts) => [...new Set(parts.filter(Boolean))];
