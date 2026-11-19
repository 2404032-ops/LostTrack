const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("priority, overdue escalation, history, task assignment and image validation work", async () => {
  let admin = await request("/api/state", fixture.tokens.admin);
  assert.equal(admin.reports.find(report => report.id === "overdue-1").overdue, true);
  const issue = admin.reports.find(report => report.id === "issue-1");
  assert.equal(issue.score, 28);
  issue.severity = "High";
  issue.safetyRisk = true;
  const scored = await request("/api/state", fixture.tokens.admin, admin);
  const scoredIssue = scored.state.reports.find(report => report.id === "issue-1");
  assert.equal(scoredIssue.score, 62);
  assert.equal(scoredIssue.suggestedPriority, "High");
  admin = scored.state;
  const updatedIssue = admin.reports.find(report => report.id === "issue-1");
  updatedIssue.priority = "High";
  updatedIssue.overrideReason = "Flooding risk";
  admin.tasks.push({ id: "task-new", reportId: "issue-1", assignee: fixture.users.staff.name, assigneeEmail: fixture.users.staff.email, text: "Clear the drain" });
  const saved = await request("/api/state", fixture.tokens.admin, admin);
  const reviewed = saved.state.reports.find(report => report.id === "issue-1");
  assert.equal(reviewed.priority, "High");
  assert(reviewed.history.some(entry => entry.includes("Flooding risk")));
  assert(reviewed.history.some(entry => entry.includes("Task assigned")));
  assert(saved.state.tasks.some(task => task.id === "task-new" && task.status === "Assigned"));
  const invalidOverride = await request("/api/state", fixture.tokens.admin, {
    ...saved.state,
    reports: saved.state.reports.map(report => report.id === "issue-1" ? { ...report, priority: "Low", overrideReason: "" } : report)
  }, 400);
  assert.match(invalidOverride.error, /reason/i);
  const invalidStatus = await request("/api/state", fixture.tokens.admin, {
    ...saved.state,
    reports: saved.state.reports.map(report => report.id === "issue-1" ? { ...report, status: "Returned" } : report)
  }, 400);
  assert.match(invalidStatus.error, /status transition/i);
  const invalidTypeChange = await request("/api/state", fixture.tokens.admin, {
    ...saved.state,
    reports: saved.state.reports.map(report => report.id === "issue-1" ? { ...report, type: "found" } : report)
  }, 400);
  assert.match(invalidTypeChange.error, /type cannot be changed/i);
  const invalidSeverity = await request("/api/state", fixture.tokens.admin, {
    ...saved.state,
    reports: saved.state.reports.map(report => report.id === "issue-1" ? { ...report, severity: "Critical" } : report)
  }, 400);
  assert.match(invalidSeverity.error, /severity/i);
  const invalidSafetyRisk = await request("/api/state", fixture.tokens.admin, {
    ...saved.state,
    reports: saved.state.reports.map(report => report.id === "issue-1" ? { ...report, safetyRisk: "true" } : report)
  }, 400);
  assert.match(invalidSafetyRisk.error, /safety risk/i);
  const invalidFile = await request("/api/uploads", fixture.tokens.student, { files: [{ data: Buffer.from("MZ executable").toString("base64") }] }, 400);
  assert.match(invalidFile.error, /JPG, PNG, or WebP/i);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  await request("/api/uploads", fixture.tokens.student, {
    files: [{ data: pngSignature }, { data: Buffer.from("MZ executable").toString("base64") }]
  }, 400);
  const uploadDirectory = path.join(fixture.temporaryDirectory, "uploads");
  assert.equal(fs.existsSync(uploadDirectory) ? fs.readdirSync(uploadDirectory).length : 0, 0);
  await request("/api/uploads", fixture.tokens.student, { files: Array(4).fill({ data: pngSignature }) }, 400);
  const oversized = await request("/api/uploads", fixture.tokens.student, { files: [{ data: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") }] }, 400);
  assert.match(oversized.error, /2 MB/i);
  const png = Buffer.alloc(1.5 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  const accepted = await request("/api/uploads", fixture.tokens.student, { files: [{ data: png.toString("base64") }] }, 201);
  assert.equal(accepted.urls.length, 1);
  const image = await fetch(`${fixture.baseUrl}${accepted.urls[0]}`);
  assert.equal(image.headers.get("content-type"), "image/png");
  const threePhotos = await request("/api/uploads", fixture.tokens.student, { files: Array(3).fill({ data: pngSignature }) }, 201);
  assert.equal(threePhotos.urls.length, 3);
  const staffUpload = await request("/api/uploads", fixture.tokens.staff, { files: [{ data: pngSignature }] }, 201);
  assert.equal(staffUpload.urls.length, 1);
});

test("only administrators can delete a report and its dependent records", async () => {
  const original = readDatabase();
  const reportId = "delete-test-report";
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  const upload = await request("/api/uploads", fixture.tokens.student, { files: [{ data: pngSignature }] }, 201);
  const imagePath = path.join(fixture.temporaryDirectory, "uploads", path.basename(upload.urls[0]));
  const db = structuredClone(original);
  db.reports.push({
    id: reportId, type: "issue", title: "Delete test", category: "Waste",
    place: "Test location", date: new Date().toISOString().slice(0, 10),
    text: "Temporary report for CRUD test.", status: "Open", priority: "Low",
    createdBy: fixture.users.student.id, campusId: "uftb-main", votes: 0, votedBy: [],
    photos: upload.urls
  });
  db.claims.push({ id: "delete-test-claim", reportId, claimantId: fixture.users.claimant.id });
  db.privateClues.push({ id: "delete-test-clue", reportId, clue: "Temporary clue" });
  db.tasks.push({ id: "delete-test-task", reportId, assigneeEmail: fixture.users.staff.email });
  db.notifications.push({ id: "delete-test-notification", refId: reportId, userId: fixture.users.admin.id });
  writeDatabase(db);
  try {
    const endpoint = `${fixture.baseUrl}/api/admin/reports/${reportId}`;
    const denied = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fixture.tokens.student}` }
    });
    assert.equal(denied.status, 403);
    assert.equal(fs.existsSync(imagePath), true);

    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fixture.tokens.admin}` }
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    assert.equal(result.state.reports.some(report => report.id === reportId), false);
    assert.equal(result.state.claims.some(claim => claim.reportId === reportId), false);
    assert.equal(result.state.privateClues.some(clue => clue.reportId === reportId), false);
    assert.equal(result.state.tasks.some(task => task.reportId === reportId), false);
    assert.equal(result.state.notifications.find(note => note.id === "delete-test-notification").refId, null);
    assert.equal(fs.existsSync(imagePath), false);
  } finally {
    writeDatabase(original);
  }
});
