const boundary = require("../../frontend/assets/data/bangladesh-boundary.json");
const polygons = boundary.geometry.coordinates;
const bounds = polygons.flat(2).reduce((result, [longitude, latitude]) => ({
  minLongitude: Math.min(result.minLongitude, longitude),
  minLatitude: Math.min(result.minLatitude, latitude),
  maxLongitude: Math.max(result.maxLongitude, longitude),
  maxLatitude: Math.max(result.maxLatitude, latitude)
}), {
  minLongitude: Infinity,
  minLatitude: Infinity,
  maxLongitude: -Infinity,
  maxLatitude: -Infinity
});

function pointInRing(longitude, latitude, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    const cross = (longitude - currentLongitude) * (previousLatitude - currentLatitude) -
      (latitude - currentLatitude) * (previousLongitude - currentLongitude);
    if (Math.abs(cross) < 1e-9 &&
      longitude >= Math.min(currentLongitude, previousLongitude) &&
      longitude <= Math.max(currentLongitude, previousLongitude) &&
      latitude >= Math.min(currentLatitude, previousLatitude) &&
      latitude <= Math.max(currentLatitude, previousLatitude)) return true;
    if ((currentLatitude > latitude) !== (previousLatitude > latitude) &&
      longitude < (previousLongitude - currentLongitude) * (latitude - currentLatitude) /
      (previousLatitude - currentLatitude) + currentLongitude) inside = !inside;
  }
  return inside;
}

function isBangladeshPoint(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    longitude < bounds.minLongitude || longitude > bounds.maxLongitude ||
    latitude < bounds.minLatitude || latitude > bounds.maxLatitude) return false;
  return polygons.some(polygon => pointInRing(longitude, latitude, polygon[0]) &&
    !polygon.slice(1).some(hole => pointInRing(longitude, latitude, hole)));
}

module.exports = { boundary, bounds, isBangladeshPoint };
