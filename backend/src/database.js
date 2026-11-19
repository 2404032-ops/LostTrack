const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { dataFile, dataDir, uploadDir, reportRetentionDays } = require("./config");

const seed = {
  accounts: [],
  reports: [],
  claims: [],
  privateClues: [],
  notifications: [],
  tasks: []
};
const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "losttrack-uploads";
const requireCloudStorage = process.env.LOSTTRACK_REQUIRE_CLOUD_STORAGE === "true";
const hasCloudSettings = Boolean(supabaseUrl || supabaseKey);
let cloudStorage = false;
let databaseCache;
let persistedCache;
let writeQueue = Promise.resolve();

if (hasCloudSettings && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}
if (supabaseUrl) {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }
}
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storageBucket)) {
  throw new Error("SUPABASE_STORAGE_BUCKET must be a valid bucket name.");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDb(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The stored LostTrack database must be a JSON object.");
  }
  const db = input;
  for (const key of ["accounts", "reports", "claims", "privateClues", "notifications", "tasks"]) {
    db[key] = Array.isArray(db[key]) ? db[key] : [];
  }
  let changed = false;
  for (const report of db.reports) {
    if (typeof report.clue === "string" && report.clue.trim()) {
      db.privateClues.push({ reportId: report.id, clue: report.clue, recordedBy: "migration", recordedAt: report.createdAt || new Date().toISOString(), campusId: "uftb-main" });
      delete report.clue;
      changed = true;
    }
    if (!report.campusId) { report.campusId = "uftb-main"; changed = true; }
  }
  for (const record of [...db.accounts, ...db.tasks, ...db.notifications]) {
    if (!record.campusId) { record.campusId = "uftb-main"; changed = true; }
  }
  const expired = db.reports.filter(report =>
    ["Resolved", "Returned", "Merged"].includes(report.status) &&
    Date.now() - Date.parse(report.statusChangedAt || report.updatedAt || report.createdAt || 0) > reportRetentionDays * 86400000);
  if (expired.length) {
    const ids = new Set(expired.map(report => String(report.id)));
    db.reports = db.reports.filter(report => !ids.has(String(report.id)));
    db.claims = db.claims.filter(claim => !ids.has(String(claim.reportId)));
    db.privateClues = db.privateClues.filter(clue => !ids.has(String(clue.reportId)));
    db.tasks = db.tasks.filter(task => !ids.has(String(task.reportId)));
    db.notifications = db.notifications.filter(notification => !ids.has(String(notification.refId)));
    changed = true;
  }
  return { db, changed, expired };
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...extra
  };
}

async function supabaseRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${supabaseUrl}${endpoint}`, {
      ...options,
      headers: supabaseHeaders(options.headers)
    });
  } catch (error) {
    throw new Error(`Supabase request failed: ${error.message}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return response;
}

async function ensureStorageBucket() {
  const bucketPath = `/storage/v1/bucket/${encodeURIComponent(storageBucket)}`;
  let response;
  try {
    response = await fetch(`${supabaseUrl}${bucketPath}`, { headers: supabaseHeaders() });
  } catch (error) {
    throw new Error(`Supabase Storage request failed: ${error.message}`);
  }
  if (response.ok) {
    const bucket = await response.json();
    if (bucket.public !== false) throw new Error("The Supabase upload bucket must be private.");
    return;
  }
  if (response.status !== 404) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase Storage bucket check failed (${response.status}): ${detail}`);
  }
  await supabaseRequest("/storage/v1/bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: storageBucket,
      name: storageBucket,
      public: false,
      file_size_limit: 2 * 1024 * 1024,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"]
    })
  });
}

function localWrite(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  const temp = `${dataFile}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, dataFile);
}

async function persistDb(db) {
  if (!cloudStorage) {
    localWrite(db);
    return;
  }
  await supabaseRequest("/rest/v1/rpc/replace_losttrack_state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_state: db })
  });
}

async function initializeDb() {
  if (databaseCache) return;
  cloudStorage = hasCloudSettings;
  if (requireCloudStorage && !cloudStorage) {
    throw new Error("Cloud storage is required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  let loaded;
  let isNew = false;
  if (cloudStorage) {
    await ensureStorageBucket();
    const response = await supabaseRequest("/rest/v1/rpc/get_losttrack_state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    loaded = await response.json();
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw new Error("Supabase returned an invalid LostTrack database response.");
    }
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    isNew = !fs.existsSync(dataFile);
    loaded = isNew ? clone(seed) : JSON.parse(fs.readFileSync(dataFile, "utf8"));
  }

  const normalized = normalizeDb(loaded);
  databaseCache = clone(normalized.db);
  for (const report of normalized.expired) {
    for (const photo of report.photos || []) {
      const name = path.basename(photo);
      if (/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(name)) await deleteUpload(name);
    }
  }
  if ((!cloudStorage && isNew) || normalized.changed) await persistDb(databaseCache);
  persistedCache = clone(databaseCache);
}

function readDb() {
  if (!databaseCache) throw new Error("LostTrack database has not been initialized.");
  if (!cloudStorage) {
    return normalizeDb(JSON.parse(fs.readFileSync(dataFile, "utf8"))).db;
  }
  return clone(databaseCache);
}

function writeDb(db) {
  if (!databaseCache) throw new Error("LostTrack database has not been initialized.");
  const snapshot = clone(db);
  databaseCache = snapshot;
  if (!cloudStorage) {
    localWrite(snapshot);
    persistedCache = clone(snapshot);
    return Promise.resolve();
  }
  const pending = writeQueue.then(async () => {
    await persistDb(snapshot);
    persistedCache = clone(snapshot);
  });
  const result = pending.catch(error => {
    if (databaseCache === snapshot) databaseCache = clone(persistedCache);
    const failure = new Error(`Database persistence failed: ${error.message}`);
    failure.code = "PERSISTENCE_ERROR";
    failure.cause = error;
    throw failure;
  });
  writeQueue = result.catch(() => {});
  return result;
}

async function uploadImage(name, bytes, mime) {
  if (!cloudStorage) {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, name), bytes, { flag: "wx" });
    return;
  }
  await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": mime, "x-upsert": "false" },
    body: bytes
  });
}

async function readUpload(name) {
  if (!cloudStorage) {
    const file = path.join(uploadDir, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  let response;
  try {
    response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/${encodeURIComponent(name)}`, {
      headers: supabaseHeaders()
    });
  } catch (error) {
    throw new Error(`Supabase Storage request failed: ${error.message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Supabase Storage request failed (${response.status}): ${detail}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function deleteUpload(name) {
  if (!cloudStorage) {
    const file = path.join(uploadDir, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  await supabaseRequest(`/storage/v1/object/${encodeURIComponent(storageBucket)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [name] })
  });
}

module.exports = { initializeDb, readDb, writeDb, uploadImage, readUpload, deleteUpload };
