const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { after, before } = require("node:test");

const password = "LostTrackTest@2026";
const root = path.resolve(__dirname, "../..");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "losttrack-test-"));
const databaseFile = path.join(temporaryDirectory, "db.json");
const day = 86400000;
let server;
let geocoderServer;
let geocoderPort;
let geocoderRequests = [];
let baseUrl;
let tokens;
let users;

function account(id, name, email, role, ageDays = 10) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    id, name, email, role, requestedRole: role, status: "active",
    passwordHash: `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`,
    createdAt: new Date(Date.now() - ageDays * day).toISOString()
  };
}

async function unusedPort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function request(endpoint, token, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `${endpoint} returned ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

async function login(email) {
  return (await request("/api/login", null, { email, password })).user;
}

function readDatabase() {
  return JSON.parse(fs.readFileSync(databaseFile, "utf8"));
}

function writeDatabase(database) {
  fs.writeFileSync(databaseFile, JSON.stringify(database, null, 2));
}

function testEnvironment(port, file, extra = {}) {
  const environment = { ...process.env };
  for (const key of [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET",
    "LOSTTRACK_REQUIRE_CLOUD_STORAGE"
  ]) delete environment[key];
  Object.assign(environment, { PORT: String(port), HOST: "127.0.0.1", LOSTTRACK_DATA_FILE: file }, extra);
  return environment;
}

async function startServer(url, environment) {
  const child = spawn(process.execPath, [path.join(root, "backend", "src", "server.js")], {
    cwd: root, env: environment, stdio: "ignore"
  });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try {
      ready = (await fetch(`${url}/api/health`)).ok;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!ready) child.kill();
  assert.equal(ready, true, "test server did not start");
  return child;
}

before(async () => {
  users = {
    admin: account("admin-1", "Admin", "admin@uftb.ac.bd", "admin"),
    student: account("student-1", "Student", "student@uftb.ac.bd", "user"),
    claimant: account("student-2", "Claimant", "claimant@uftb.ac.bd", "user"),
    staff: account("staff-1", "Staff", "staff@uftb.ac.bd", "staff"),
    otherStaff: account("staff-2", "Other Staff", "other-staff@uftb.ac.bd", "staff")
  };
  users.student.emailVerificationTokenHash = "verification-token-hash";
  users.student.emailVerificationExpiresAt = Date.now() + day;
  const now = new Date().toISOString();
  writeDatabase({
    accounts: Object.values(users),
    reports: [
      { id: "found-1", type: "found", title: "Blue wallet", category: "Wallet", place: "Library", date: now.slice(0, 10), color: "Blue", text: "small silver star", status: "Found", priority: "Medium", createdBy: users.claimant.id, createdAt: now, votes: 0, votedBy: [], history: [] },
      { id: "issue-1", type: "issue", title: "Blocked drain", category: "Drainage", place: "Gate 2", date: now.slice(0, 10), text: "Water collects near the entrance", severity: "Medium", safetyRisk: false, status: "Open", priority: "Medium", createdBy: users.student.id, createdAt: now, votes: 0, votedBy: [], history: [] },
      { id: "overdue-1", type: "issue", title: "Old hazard", category: "Waste", place: "Courtyard", date: now.slice(0, 10), text: "Overflowing bin", severity: "High", safetyRisk: false, status: "Open", priority: "High", createdBy: users.student.id, createdAt: new Date(Date.now() - 8 * day).toISOString(), votes: 0, votedBy: [], history: [] },
      { id: "expired-closed-report", type: "issue", title: "Expired report", status: "Resolved", createdAt: new Date(Date.now() - 8 * day).toISOString() },
      { id: "retained-closed-report", type: "issue", title: "Retained report", category: "Other", place: "Library", date: now.slice(0, 10), text: "A retained closed test report", status: "Resolved", priority: "Low", severity: "Low", safetyRisk: false, createdBy: users.student.id, createdAt: new Date(Date.now() - 6 * day).toISOString(), votes: 0, votedBy: [], history: [] }
    ],
    claims: [{ id: "expired-claim", reportId: "expired-closed-report" }],
    privateClues: [
      { reportId: "found-1", clue: "Silver star inside", recordedBy: users.admin.id, recordedAt: now },
      { reportId: "expired-closed-report", clue: "Expired clue" }
    ],
    notifications: [{ id: "expired-notification", refId: "expired-closed-report" }],
    tasks: [
      { id: "task-staff", reportId: "issue-1", assignee: users.staff.name, assigneeEmail: users.staff.email, status: "Assigned", text: "Inspect the drain" },
      { id: "task-other", reportId: "issue-1", assignee: users.otherStaff.name, assigneeEmail: users.otherStaff.email, status: "Assigned", text: "Other staff task" },
      { id: "expired-task", reportId: "expired-closed-report" }
    ]
  });
  const port = await unusedPort();
  geocoderPort = await unusedPort();
  geocoderRequests = [];
  geocoderServer = http.createServer((req, res) => {
    geocoderRequests.push({
      url: new URL(req.url, "http://localhost"),
      userAgent: req.headers["user-agent"],
      acceptLanguage: req.headers["accept-language"]
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([
      {
        name: "BUET",
        namedetails: { "name:en": "Bangladesh University of Engineering and Technology" },
        display_name: "Bangladesh University of Engineering and Technology, Dhaka, Bangladesh",
        lat: "23.7265", lon: "90.3925", type: "university"
      },
      { display_name: "Eiffel Tower, Paris, France", lat: "48.8584", lon: "2.2945" },
      { display_name: "CN Tower, Toronto, Canada", lat: "43.6426", lon: "-79.3871" },
      { display_name: "Invalid location", lat: "not-a-number", lon: "90.3" },
      { display_name: "Missing coordinates", lat: "", lon: "90.3" },
      { display_name: "Out-of-range location", lat: "91", lon: "181" }
    ]));
  });
  await new Promise(resolve => geocoderServer.listen(geocoderPort, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  server = await startServer(baseUrl, testEnvironment(port, databaseFile, {
    LOSTTRACK_REPORT_RETENTION_DAYS: "7",
    LOCATION_SEARCH_URL: `http://127.0.0.1:${geocoderPort}/search`
  }));
  tokens = {
    admin: (await login(users.admin.email)).token,
    student: (await login(users.student.email)).token,
    claimant: (await login(users.claimant.email)).token,
    staff: (await login(users.staff.email)).token,
    otherStaff: (await login(users.otherStaff.email)).token
  };
});

after(() => {
  if (server && !server.killed) server.kill();
  if (geocoderServer) geocoderServer.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
module.exports = {
  assert, crypto, fs, os, path, spawnSync, vm, password, root,
  request, login, readDatabase, writeDatabase, testEnvironment, startServer, unusedPort,
  get databaseFile() { return databaseFile; },
  get temporaryDirectory() { return temporaryDirectory; },
  get baseUrl() { return baseUrl; },
  get tokens() { return tokens; },
  get users() { return users; },
  get geocoderRequests() { return geocoderRequests; }
};
