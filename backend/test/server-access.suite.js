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

test("email verification is not required for campus actions", async () => {
  const database = readDatabase();
  const student = database.accounts.find(item => item.id === fixture.users.student.id);
  const studentEmailVerified = student.emailVerified;
  student.emailVerified = false;
  writeDatabase(database);
  try {
    const state = await request("/api/state", fixture.tokens.student);
    assert.equal(Object.hasOwn(state, "emailVerified"), false);
    state.reports.find(report => report.id === "issue-1").title = "Unverified report edit";
    const editResponse = await request("/api/state", fixture.tokens.student, state);
    assert.equal(editResponse.state.reports.find(report => report.id === "issue-1").title, "Unverified report edit");
    const freshState = await request("/api/state", fixture.tokens.student);
    freshState.reports.push({
      ...freshState.reports.find(report => report.id === "issue-1"),
      id: "unverified-report",
      createdBy: fixture.users.student.id,
      consent: true
    });
    const reportResponse = await request("/api/state", fixture.tokens.student, freshState);
    assert(reportResponse.state.reports.some(report => report.id === "unverified-report"));
    await request("/api/vote", fixture.tokens.student, { reportId: "issue-1" });
    await request("/api/claims", fixture.tokens.student, {
      reportId: "found-1",
      detail: "A private detail",
      consent: true
    }, 201);
    const invalidUpload = await request("/api/uploads", fixture.tokens.student, {
      files: [{ data: Buffer.from("not an image").toString("base64") }]
    }, 400);
    assert.match(invalidUpload.error, /JPG, PNG, or WebP/i);
  } finally {
    if (studentEmailVerified === undefined) delete student.emailVerified;
    else student.emailVerified = studentEmailVerified;
    writeDatabase(database);
  }
  const staffDatabase = readDatabase();
  const staff = staffDatabase.accounts.find(item => item.id === fixture.users.staff.id);
  const staffEmailVerified = staff.emailVerified;
  staff.emailVerified = false;
  writeDatabase(staffDatabase);
  try {
    const staffState = await request("/api/state", fixture.tokens.staff);
    staffState.tasks.find(task => task.id === "task-staff").status = "In progress";
    const taskResponse = await request("/api/state", fixture.tokens.staff, staffState);
    assert.equal(taskResponse.state.tasks.find(task => task.id === "task-staff").status, "In progress");
  } finally {
    if (staffEmailVerified === undefined) delete staff.emailVerified;
    else staff.emailVerified = staffEmailVerified;
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
