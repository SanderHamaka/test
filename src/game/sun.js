const RAD = Math.PI / 180;

/**
 * Position of the sun for a moment and place (NOAA solar position approximations, accurate to a
 * fraction of a degree, which is plenty for lighting).
 * @returns { elevation, azimuth } in degrees; azimuth clockwise from north.
 */
export function sunPosition(date, lat, lon) {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const t = (julianDay - 2451545) / 36525; // Julian centuries since J2000

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const apparentLong = meanLong + centre - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * RAD);
  const obliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos((125.04 - 1934.136 * t) * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD));

  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime = 4 / RAD * (
    y * Math.sin(2 * meanLong * RAD) -
    2 * eccentricity * Math.sin(meanAnomaly * RAD) +
    4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLong * RAD) -
    0.5 * y * y * Math.sin(4 * meanLong * RAD) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD)
  ); // minutes

  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (((minutes + equationOfTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolarTime / 4 - 180) * RAD;

  const latRad = lat * RAD;
  const cosZenith = Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad),
  ) / RAD + 180;

  return { elevation: 90 - zenith / RAD, azimuth: azimuth % 360 };
}

/** Local solar time of day in hours (12 = sun at its highest), for showing the time to the player. */
export function solarHours(date, lon) {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + lon / 15;
  return ((hours % 24) + 24) % 24;
}

/** The moment at which local solar time at `lon` is `hours`, on the same UTC day as `date`. */
export function atSolarHours(date, lon, hours) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + ((hours - lon / 15) * 3600000));
}
