const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("Bangladesh location search is authenticated, English-only, cached, and rate-limited", async () => {
  const boundaryResponse = await fetch(`${fixture.baseUrl}/assets/data/bangladesh-boundary.json`);
  assert.equal(boundaryResponse.status, 200);
  assert.equal((await boundaryResponse.json()).geometry.type, "MultiPolygon");
  const unauthenticated = await fetch(`${fixture.baseUrl}/api/location-search?q=BUET`);
  assert.equal(unauthenticated.status, 401);
  await request("/api/location-search?q=ab", fixture.tokens.student, undefined, 400);
  const result = await request("/api/location-search?q=BUET", fixture.tokens.student);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, "Bangladesh University of Engineering and Technology");
  assert.equal(result.results[0].nameEnglish, "Bangladesh University of Engineering and Technology");
  assert.equal(result.results[0].latitude, 23.7265);
  assert.equal(result.results[0].longitude, 90.3925);
  assert.equal(Object.hasOwn(result.results[0], "address"), false);
  assert.equal(fixture.geocoderRequests.length, 1);
  assert.equal(fixture.geocoderRequests[0].url.searchParams.get("countrycodes"), "bd");
  assert.equal(fixture.geocoderRequests[0].url.searchParams.get("q"), "BUET");
  assert.equal(fixture.geocoderRequests[0].url.searchParams.get("namedetails"), "1");
  assert.equal(fixture.geocoderRequests[0].acceptLanguage, "en");
  assert.match(fixture.geocoderRequests[0].userAgent, /LostTrack/);
  const cached = await request("/api/location-search?q=BUET", fixture.tokens.student);
  assert.deepEqual(cached.results, result.results);
  assert.equal(fixture.geocoderRequests.length, 1);
  const rateLimited = await fetch(`${fixture.baseUrl}/api/location-search?q=Dhaka College`, {
    headers: { Authorization: `Bearer ${fixture.tokens.student}` }
  });
  assert.equal(rateLimited.status, 429);
  assert.ok(Number(rateLimited.headers.get("retry-after")) > 0);
  await rateLimited.json();
  assert.equal(fixture.geocoderRequests.length, 1);
});
