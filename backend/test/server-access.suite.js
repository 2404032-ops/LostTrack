const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("role access and sensitive fields are enforced on the server", async () => {
  const healthResponse = await fetch(`${fixture.baseUrl}/api/health`, { headers: { Host: "[" } });
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(healthResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(healthResponse.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(healthResponse.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  await request("/api/state", null, undefined, 401);
  await request("/api/admin/accounts", fixture.tokens.student, undefined, 403);
  await request("/api/vote", null, { reportId: "issue-1" }, 401);
  const student = await request("/api/state", fixture.tokens.student);
  const staff = await request("/api/state", fixture.tokens.staff);
  const admin = await request("/api/state", fixture.tokens.admin);
  assert.equal(student.reports.find(report => report.id === "found-1").clue, undefined);
  assert.equal(student.privateClues, undefined);
  assert.equal(student.tasks.length, 0);
  assert.deepEqual(student.claims, []);
  assert.equal(staff.reports.find(report => report.id === "found-1").clue, undefined);
  assert.deepEqual(staff.tasks.map(task => task.id), ["task-staff"]);
  assert.equal(admin.privateClues[0].clue, "Silver star inside");
  const accounts = await request("/api/admin/accounts", fixture.tokens.admin);
  assert(accounts.accounts.every(item => !Object.hasOwn(item, "passwordHash")));
  const studentAccount = accounts.accounts.find(item => item.id === fixture.users.student.id);
  assert.equal(studentAccount.emailVerificationTokenHash, undefined);
  assert.equal(studentAccount.emailVerificationExpiresAt, undefined);
});

test("unverified campus accounts cannot create or change reports, vote, claim, or upload", async () => {
  const database = readDatabase();
  const student = database.accounts.find(item => item.id === fixture.users.student.id);
  student.emailVerified = false;
  writeDatabase(database);
  try {
    const state = await request("/api/state", fixture.tokens.student);
    assert.equal(state.emailVerified, false);
    state.reports.find(report => report.id === "issue-1").title = "Unverified report edit";
    const editResponse = await request("/api/state", fixture.tokens.student, state, 403);
    assert.match(editResponse.error, /Verify your university email/);
    const freshState = await request("/api/state", fixture.tokens.student);
    freshState.reports.push({
      ...freshState.reports.find(report => report.id === "issue-1"),
      id: "unverified-report",
      createdBy: fixture.users.student.id,
      consent: true
    });
    const reportResponse = await request("/api/state", fixture.tokens.student, freshState, 403);
    assert.match(reportResponse.error, /Verify your university email/);
    const voteResponse = await request("/api/vote", fixture.tokens.student, { reportId: "issue-1" }, 403);
    assert.match(voteResponse.error, /Verify your university email/);
    const claimResponse = await request("/api/claims", fixture.tokens.student, {
      reportId: "found-1",
      detail: "A private detail",
      consent: true
    }, 403);
    assert.match(claimResponse.error, /Verify your university email/);
    const uploadResponse = await request("/api/uploads", fixture.tokens.student, { files: [] }, 403);
    assert.match(uploadResponse.error, /Verify your university email/);
  } finally {
    student.emailVerified = true;
    writeDatabase(database);
  }
  const staffDatabase = readDatabase();
  const staff = staffDatabase.accounts.find(item => item.id === fixture.users.staff.id);
  staff.emailVerified = false;
  writeDatabase(staffDatabase);
  try {
    const staffState = await request("/api/state", fixture.tokens.staff);
    staffState.tasks.find(task => task.id === "task-staff").status = "In progress";
    const taskResponse = await request("/api/state", fixture.tokens.staff, staffState, 403);
    assert.match(taskResponse.error, /Verify your university email/);
  } finally {
    staff.emailVerified = true;
    writeDatabase(staffDatabase);
  }
});

test("configured report retention controls cleanup and the displayed privacy period", async () => {
  const page = await fetch(fixture.baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="losttrack-retention-days" content="7"/);

  const database = readDatabase();
  assert.equal(database.reports.some(report => report.id === "expired-closed-report"), false);
  assert.equal(database.reports.some(report => report.id === "retained-closed-report"), true);
  assert.equal(database.claims.some(claim => claim.id === "expired-claim"), false);
  assert.equal(database.privateClues.some(clue => clue.reportId === "expired-closed-report"), false);
  assert.equal(database.tasks.some(task => task.id === "expired-task"), false);
  assert.equal(database.notifications.some(notification => notification.id === "expired-notification"), false);
});

test("privacy notices show the configured period in English and Bengali", () => {
  const notices = ["registration", "report", "claim"].map(retentionMessage => ({
    dataset: { retentionMessage },
    textContent: ""
  }));
  const placeholders = ["Your name", "Create a strong password"].map(placeholder => ({
    placeholder,
    dataset: {},
    setAttribute() {}
  }));
  const languagePreference = { value: "en" };
  const context = {
    NodeFilter: { SHOW_TEXT: 4 },
    document: {
      body: {},
      documentElement: { dataset: {}, style: {} },
      createTreeWalker: () => ({ nextNode: () => null }),
      querySelector: () => ({ content: "7" }),
      querySelectorAll: selector => selector === "[data-retention-message]" ? notices
        : selector === "input[placeholder],textarea[placeholder]" ? placeholders : []
    },
    localStorage: {
      getItem: key => key === "losttrack-language" ? languagePreference.value : null,
      setItem: (key, value) => { if (key === "losttrack-language") languagePreference.value = value; }
    },
    window: {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "frontend", "assets", "js", "language.js"), "utf8"), context);
  assert(notices.every(notice => notice.textContent.includes("7 days")));
  context.window.LostTrackI18n.toggle();
  assert(notices.every(notice => notice.textContent.includes("৭") || notice.textContent.includes("7")));
  assert(notices[0].textContent.includes("বন্ধ রিপোর্ট ও ছবি"));
  assert.equal(placeholders[0].placeholder, "আপনার নাম");
  assert.equal(placeholders[1].placeholder, "শক্তিশালী পাসওয়ার্ড তৈরি করুন");
  assert.equal(context.window.LostTrackI18n.text(
    "LostTrack's server is unavailable. Open this link on the same computer while the local server is running, or use the deployed LostTrack URL."
  ), "LostTrack সার্ভারে সংযোগ করা যাচ্ছে না। স্থানীয় সার্ভার চালু রেখে একই কম্পিউটারে লিংকটি খুলুন, অথবা চালু করা LostTrack সাইটের ঠিকানা ব্যবহার করুন।");
});

test("invalid report retention settings prevent server startup", () => {
  const result = spawnSync(process.execPath, [path.join(root, "backend", "src", "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      LOSTTRACK_DATA_FILE: path.join(fixture.temporaryDirectory, "invalid-retention-db.json"),
      LOSTTRACK_REPORT_RETENTION_DAYS: "0"
    },
    encoding: "utf8",
    timeout: 5000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LOSTTRACK_REPORT_RETENTION_DAYS must be a whole number from 1 to 3650/);
});
