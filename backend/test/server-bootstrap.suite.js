const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, testEnvironment, startServer, unusedPort } = fixture;
const http = require("node:http");
const { test } = require("node:test");

test("the first administrator can be provisioned once without public admin registration", async () => {
  const bootstrapDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "losttrack-admin-test-"));
  const bootstrapDatabase = path.join(bootstrapDirectory, "db.json");
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  let bootstrapServer;
  try {
    bootstrapServer = await startServer(url, testEnvironment(port, bootstrapDatabase, {
      LOSTTRACK_INITIAL_ADMIN_NAME: "Initial Admin",
      LOSTTRACK_INITIAL_ADMIN_EMAIL: "initial-admin@uftb.ac.bd",
      LOSTTRACK_INITIAL_ADMIN_PASSWORD: "InitialAdmin@2026"
    }));
    const loginResponse = await fetch(`${url}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "initial-admin@uftb.ac.bd", password: "InitialAdmin@2026" })
    });
    assert.equal(loginResponse.status, 200);
    const { user } = await loginResponse.json();
    assert.equal(user.role, "admin");
    const accountsResponse = await fetch(`${url}/api/admin/accounts`, {
      headers: { Authorization: "Bearer " + user.token }
    });
    assert.equal(accountsResponse.status, 200);
    const registrationResponse = await fetch(`${url}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Public Admin",
        email: "public-admin@uftb.ac.bd",
        password: "PublicAdmin@2026",
        role: "admin",
        privacyConsent: true
      })
    });
    assert.equal(registrationResponse.status, 400);
  } finally {
    if (bootstrapServer && !bootstrapServer.killed) bootstrapServer.kill();
    fs.rmSync(bootstrapDirectory, { recursive: true, force: true });
  }
});

test("Render cloud mode refuses to start without Supabase credentials", () => {
  const missingCloudDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "losttrack-cloud-required-test-"));
  try {
    const port = 32123;
    const result = spawnSync(process.execPath, [path.join(root, "backend", "src", "server.js")], {
      cwd: root,
      env: testEnvironment(port, path.join(missingCloudDirectory, "db.json"), {
        LOSTTRACK_REQUIRE_CLOUD_STORAGE: "true"
      }),
      encoding: "utf8",
      timeout: 5000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cloud storage is required/);
  } finally {
    fs.rmSync(missingCloudDirectory, { recursive: true, force: true });
  }
});

test("Supabase state and private uploads persist across app restarts", async () => {
  const cloudDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "losttrack-cloud-test-"));
  const cloudDatabase = path.join(cloudDirectory, "unused-local-db.json");
  const objects = new Map();
  const studentPassword = "CloudStudent@2026";
  const studentSalt = crypto.randomBytes(16).toString("hex");
  let state = {
    accounts: [{
      id: "cloud-student", name: "Cloud Student", email: "cloud-student@uftb.ac.bd",
      role: "user", requestedRole: "user", status: "active", emailVerified: true,
      passwordHash: `${studentSalt}:${crypto.scryptSync(studentPassword, studentSalt, 64).toString("hex")}`
    }],
    reports: [], claims: [], privateClues: [], notifications: [], tasks: []
  };
  let bucketReady = false;
  const cloudServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-service-key") {
      res.writeHead(401);
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/storage/v1/bucket/losttrack-uploads" && req.method === "GET") {
      res.writeHead(bucketReady ? 200 : 400, { "Content-Type": "application/json" });
      return res.end(bucketReady
        ? JSON.stringify({ public: false })
        : JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "Bucket not found", code: "NoSuchBucket" }));
    }
    if (url.pathname === "/storage/v1/bucket" && req.method === "POST") {
      bucketReady = true;
      res.writeHead(200);
      return res.end("{}");
    }
    if (url.pathname === "/rest/v1/rpc/get_losttrack_state" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(state));
    }
    if (url.pathname === "/rest/v1/rpc/replace_losttrack_state" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      state = JSON.parse(Buffer.concat(chunks).toString("utf8")).p_state;
      res.writeHead(204);
      return res.end();
    }
    const uploadPath = "/storage/v1/object/losttrack-uploads/";
    if (url.pathname.startsWith(uploadPath) && req.method === "POST") {
      const name = decodeURIComponent(url.pathname.slice(uploadPath.length));
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      objects.set(name, Buffer.concat(chunks));
      res.writeHead(200);
      return res.end("{}");
    }
    if (url.pathname.startsWith(uploadPath) && req.method === "GET") {
      const name = decodeURIComponent(url.pathname.slice(uploadPath.length));
      const image = objects.get(name);
      res.writeHead(image ? 200 : 404, image ? { "Content-Type": "image/png" } : {});
      return res.end(image || "");
    }
    if (url.pathname === "/storage/v1/object/losttrack-uploads" && req.method === "DELETE") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { prefixes } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      for (const name of prefixes) objects.delete(name);
      res.writeHead(200);
      return res.end("{}");
    }
    res.writeHead(404);
    res.end();
  });
  const cloudPort = await unusedPort();
  await new Promise(resolve => cloudServer.listen(cloudPort, "127.0.0.1", resolve));
  const serviceEnvironment = port => testEnvironment(port, cloudDatabase, {
    SUPABASE_URL: `http://127.0.0.1:${cloudPort}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    LOSTTRACK_REQUIRE_CLOUD_STORAGE: "true",
    LOSTTRACK_INITIAL_ADMIN_EMAIL: "cloud-admin@uftb.ac.bd",
    LOSTTRACK_INITIAL_ADMIN_PASSWORD: "CloudAdmin@2026"
  });
  let cloudApp;
  let appUrl;
  const cloudRequest = async (endpoint, token, body, expectedStatus = 200) => {
    const response = await fetch(`${appUrl}${endpoint}`, {
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
  };
  const cloudLogin = async (email, passwordValue) => (await cloudRequest("/api/login", null, {
    email, password: passwordValue
  })).user;
  try {
    let appPort = await unusedPort();
    appUrl = `http://127.0.0.1:${appPort}`;
    cloudApp = await startServer(appUrl, serviceEnvironment(appPort));
    assert.equal(bucketReady, true);
    let student = await cloudLogin("cloud-student@uftb.ac.bd", studentPassword);
    const stateResponse = await cloudRequest("/api/state", student.token);
    stateResponse.reports.push({
      id: "cloud-persisted-report", type: "lost", title: "Cloud saved item", category: "Bag",
      place: "Library", date: new Date().toISOString().slice(0, 10), text: "Stored remotely", consent: true
    });
    await cloudRequest("/api/state", student.token, stateResponse);
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const upload = await cloudRequest("/api/uploads", student.token, {
      files: [{ data: imageBytes.toString("base64") }]
    }, 201);
    const firstImage = await fetch(`${appUrl}${upload.urls[0]}`);
    assert.equal(firstImage.status, 200);
    assert.deepEqual(Buffer.from(await firstImage.arrayBuffer()), imageBytes);
    cloudApp.kill();
    cloudApp = null;

    appPort = await unusedPort();
    appUrl = `http://127.0.0.1:${appPort}`;
    cloudApp = await startServer(appUrl, serviceEnvironment(appPort));
    student = await cloudLogin("cloud-student@uftb.ac.bd", studentPassword);
    const restored = await cloudRequest("/api/state", student.token);
    assert(restored.reports.some(report => report.id === "cloud-persisted-report"));
    const restoredImage = await fetch(`${appUrl}${upload.urls[0]}`);
    assert.equal(restoredImage.status, 200);
    assert.deepEqual(Buffer.from(await restoredImage.arrayBuffer()), imageBytes);
    assert.equal(fs.existsSync(cloudDatabase), false);
  } finally {
    if (cloudApp && !cloudApp.killed) cloudApp.kill();
    cloudServer.close();
    fs.rmSync(cloudDirectory, { recursive: true, force: true });
  }
});
