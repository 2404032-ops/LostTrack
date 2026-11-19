const fixture = require("./server-fixture");
const { assert, spawnSync, password, root, request, login, readDatabase, writeDatabase } = fixture;
const { emailBaseUrl } = require("../src/auth");
const { test } = require("node:test");

test("password-reset links prefer the live Render URL and use the active local port", () => {
  assert.equal(emailBaseUrl({
    APP_BASE_URL: "http://localhost:3000",
    RENDER_EXTERNAL_URL: "https://losttrack.onrender.com"
  }, 3001), "https://losttrack.onrender.com");
  assert.equal(emailBaseUrl({ APP_BASE_URL: "http://localhost:3000" }, 3001), "http://localhost:3001");
  assert.equal(emailBaseUrl({
    APP_BASE_URL: "https://losttrack.example.com",
    RENDER_EXTERNAL_URL: "https://losttrack.onrender.com"
  }, 3001), "https://losttrack.example.com");
  assert.equal(emailBaseUrl({ RENDER_EXTERNAL_URL: "https://losttrack.onrender.com" }, 3001), "https://losttrack.onrender.com");
});

test("Brevo sends password-reset links through its HTTPS API and reports provider errors", () => {
  const script = `
    const assert = require("node:assert/strict");
    let responseStatus = 201;
    global.fetch = async (url, options) => {
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(options.headers["api-key"], "test-brevo-key");
      const message = JSON.parse(options.body);
      assert.equal(message.sender.email, "sender@example.com");
      assert.equal(message.to[0].email, "student@uftb.ac.bd");
      assert.match(message.textContent, /https:\\/\\/losttrack\\.example\\.com\\/\\?reset-token=abcdef123456/);
      return { ok: responseStatus < 300, status: responseStatus };
    };
    const auth = require("./backend/src/auth");
    (async () => {
      await auth.sendPasswordResetEmail("student@uftb.ac.bd", "abcdef123456");
      responseStatus = 401;
      await assert.rejects(auth.sendPasswordResetEmail("student@uftb.ac.bd", "abcdef123456"), /HTTP 401/);
    })().catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const environment = {
    ...process.env,
    APP_BASE_URL: "https://losttrack.example.com",
    BREVO_API_KEY: "  test-brevo-key ",
    BREVO_SENDER_EMAIL: " sender@example.com  "
  };
  for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) delete environment[key];
  const result = spawnSync(process.execPath, ["-e", script], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("registration validates university email without requiring verification", async () => {
  const database = readDatabase();
  database.reports.push({
    id: "registration-found-item", type: "found", title: "Registration test item", category: "Notebook",
    place: "Library", date: new Date().toISOString().slice(0, 10), text: "Blue notebook",
    status: "Found", priority: "Medium", createdBy: fixture.users.claimant.id,
    createdAt: new Date().toISOString(), votes: 0, votedBy: [], history: []
  });
  writeDatabase(database);
  const invalid = await request("/api/register", null, { name: "Outside User", email: "outside@example.com", password, role: "user" }, 400);
  assert.match(invalid.error, /@uftb\.ac\.bd/i);
  await request("/api/register", null, { name: "Unconsented User", email: "no-consent@uftb.ac.bd", password, role: "user" }, 400);
  const registration = await request("/api/register", null, { name: "New User", email: "new-user@uftb.ac.bd", password, role: "user", privacyConsent: true }, 201);
  assert.match(registration.message, /sign in/i);
  assert.doesNotMatch(registration.message, /verification/i);
  const newUser = await login("new-user@uftb.ac.bd");
  assert.equal(Object.hasOwn(newUser, "emailVerified"), false);
  const newUserState = await request("/api/state", newUser.token);
  assert.equal(Object.hasOwn(newUserState, "emailVerified"), false);
  await request("/api/send-verification-email", newUser.token, {}, 404);
  await request("/api/verify-email", null, { token: "unused" }, 404);
  const submittedClaim = await request("/api/claims", newUser.token, {
    reportId: "registration-found-item", detail: "New claimant details", consent: true
  }, 201);
  assert.equal(submittedClaim.state.claims[0].detail, undefined);
  const newAccount = readDatabase().accounts.find(item => item.email === "new-user@uftb.ac.bd");
  assert.equal(Object.hasOwn(newAccount, "emailVerified"), false);
  assert.equal(newAccount.privacyConsentVersion, "1.0");
  assert(newAccount.privacyConsentAt);
});

test("returning a found item requires an approved claim and in-person identity check", async () => {
  const student = await request("/api/state", fixture.tokens.student);
  student.reports.push({
    id: "handover-found", type: "found", title: "Found blue notebook", category: "Notebook",
    place: "Library", date: new Date().toISOString().slice(0, 10), text: "Blue notebook",
    status: "Found", priority: "Medium", consent: true
  });
  await request("/api/state", fixture.tokens.student, student);

  let admin = await request("/api/state", fixture.tokens.admin);
  let report = admin.reports.find(item => item.id === "handover-found");
  report.status = "Returned";
  report.identityChecked = true;
  const unapproved = await request("/api/state", fixture.tokens.admin, admin, 400);
  assert.match(unapproved.error, /approved claim/i);

  await request("/api/claims", fixture.tokens.claimant, {
    reportId: "handover-found", detail: "A label inside", consent: true
  }, 201);
  admin = await request("/api/state", fixture.tokens.admin);
  admin.claims.find(claim => claim.reportId === "handover-found").status = "Approved";
  await request("/api/state", fixture.tokens.admin, admin);

  admin = await request("/api/state", fixture.tokens.admin);
  report = admin.reports.find(item => item.id === "handover-found");
  report.status = "Returned";
  const unchecked = await request("/api/state", fixture.tokens.admin, admin, 400);
  assert.match(unchecked.error, /in-person identity check/i);

  report.identityChecked = true;
  const returned = await request("/api/state", fixture.tokens.admin, admin);
  const updated = returned.state.reports.find(item => item.id === "handover-found");
  assert.equal(updated.status, "Returned");
  assert(updated.history.some(entry => entry.includes("in-person identity check")));
  assert.equal(Object.hasOwn(updated, "identityChecked"), false);
});
