/**
 * Weather presets and the real current weather for a place (Open-Meteo: free, no key).
 *
 * A preset is a few numbers the rest of the game reads:
 *   cloud     sky cloud coverage 0..1 (also how many cloud banks to fly through)
 *   overcast  how much the clouds dim the sun and flatten the light 0..1
 *   rain      rain intensity 0..1 (particles, sound, wet streets)
 *   fog       fog 0..1 (pulls the fog in close)
 */
export const WEATHER = {
  clear: { label: 'Clear', cloud: 0.12, overcast: 0, rain: 0, fog: 0 },
  cloudy: { label: 'Cloudy', cloud: 0.5, overcast: 0.25, rain: 0, fog: 0 },
  overcast: { label: 'Overcast', cloud: 0.85, overcast: 0.7, rain: 0, fog: 0.15 },
  rain: { label: 'Rain', cloud: 0.95, overcast: 0.8, rain: 0.75, fog: 0.3 },
  storm: { label: 'Storm', cloud: 1, overcast: 0.95, rain: 1, fog: 0.45 },
  fog: { label: 'Fog', cloud: 0.6, overcast: 0.6, rain: 0, fog: 1 },
};

/** WMO weather codes (used by Open-Meteo) → preset. */
function presetForCode(code, cloudCover) {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 71 && code <= 86) return 'overcast'; // snow: no snowflakes yet, so at least make it grey
  if (code === 3 || cloudCover > 80) return 'overcast';
  if (code === 2 || cloudCover > 35) return 'cloudy';
  return 'clear';
}

/**
 * Current weather at a place: { preset, wind: { speed m/s, from degrees } }, or null when the service
 * can't be reached (the game then stays with clear skies).
 */
export async function fetchRealWeather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms',
  });
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const { current } = await response.json();
    return {
      preset: presetForCode(current.weather_code, current.cloud_cover),
      wind: { speed: current.wind_speed_10m ?? 0, from: current.wind_direction_10m ?? 0 },
    };
  } catch {
    return null;
  }
}

/** Smoothly blends between presets so weather changes don't snap. */
export class WeatherState {
  constructor(preset = 'clear') {
    this.target = { ...WEATHER[preset] };
    this.current = { ...WEATHER[preset] };
    this.preset = preset;
    this.wind = { speed: 3, from: 240 }; // a light south-westerly breeze until we know better
  }

  set(preset, wind) {
    this.preset = preset;
    this.target = { ...WEATHER[preset] };
    if (wind) this.wind = wind;
  }

  /** @returns true while still changing (the sky and its reflections then need refreshing now and then) */
  update(dt) {
    let changing = false;
    for (const key of ['cloud', 'overcast', 'rain', 'fog']) {
      const delta = this.target[key] - this.current[key];
      if (Math.abs(delta) > 0.001) {
        this.current[key] += Math.sign(delta) * Math.min(Math.abs(delta), dt * 0.15);
        changing = true;
      }
    }
    return changing;
  }

  /** Wind as a velocity in local x/z (m/s): blowing *towards* the opposite of where it comes from. */
  windVector() {
    const to = ((this.wind.from + 180) * Math.PI) / 180; // compass bearing, clockwise from north
    return { x: Math.sin(to) * this.wind.speed, z: -Math.cos(to) * this.wind.speed };
  }
}
