const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("student report creation, duplicate detection, and unique votes ignore forged client data", async () => {
  const student = await request("/api/state", fixture.tokens.student);
  await request("/api/state", fixture.tokens.student, {
    ...student,
    reports: [...student.reports, {
      id: "missing-report-consent", type: "lost", title: "Consent check", category: "Bag",
      place: "Library", date: new Date().toISOString().slice(0, 10), text: "Test report"
    }]
  }, 400);
  const issue = student.reports.find(report => report.id === "issue-1");
  issue.status = "Resolved";
  issue.priority = "High";
  issue.safetyRisk = true;
  issue.votes = 99;
  issue.voted = false;
  const found = student.reports.find(report => report.id === "found-1");
  found.status = "Returned";
  found.clue = "forged clue";
  const forged = {
    id: "new-issue", type: "issue", title: "Another blocked drain", category: "Drainage",
    place: "Gate 2", date: new Date().toISOString().slice(0, 10), text: "Water is pooling",
    status: "Resolved", priority: "High", severity: "High", safetyRisk: true, consent: true,
    createdBy: "someone-else", clue: "forged", history: ["forged history"]
  };
  student.reports.push(forged);
  student.tasks.push({ id: "forged-task", status: "Completed" });
  const saved = await request("/api/state", fixture.tokens.student, student);
  const protectedIssue = saved.state.reports.find(report => report.id === "issue-1");
  assert.equal(protectedIssue.status, "Open");
  assert.equal(protectedIssue.priority, "Medium");
  assert.equal(protectedIssue.safetyRisk, false);
  assert.equal(protectedIssue.votes, 0);
  const created = saved.state.reports.find(report => report.id === "new-issue");
  assert.equal(created.createdBy, fixture.users.student.id);
  assert.equal(created.status, "Open");
  assert.equal(created.priority, "Medium");
  assert.equal(created.possibleDuplicate, true);
  assert.equal(created.history.some(entry => entry.includes("forged")), false);
  assert.equal(created.clue, undefined);
  assert.equal(created.consentVersion, "1.0");
  assert.equal(saved.state.tasks.some(task => task.id === "forged-task"), false);
  const firstVote = await request("/api/vote", fixture.tokens.student, { reportId: "issue-1" });
  assert.equal(firstVote.state.reports.find(report => report.id === "issue-1").votes, 1);
  await request("/api/vote", fixture.tokens.student, { reportId: "issue-1" }, 409);
  const replay = await request("/api/state", fixture.tokens.student, firstVote.state);
  assert.equal(replay.state.reports.find(report => report.id === "issue-1").votes, 1);
  const admin = await request("/api/state", fixture.tokens.admin);
  admin.reports.find(report => report.id === "new-issue").status = "Resolved";
  await request("/api/state", fixture.tokens.admin, admin);
  const studentAfterClose = await request("/api/state", fixture.tokens.student);
  const closedIssue = studentAfterClose.reports.find(report => report.id === "new-issue");
  closedIssue.title = "Forged edit after close";
  closedIssue.voted = true;
  const closedVote = await request("/api/state", fixture.tokens.student, studentAfterClose);
  assert.equal(closedVote.state.reports.find(report => report.id === "new-issue").votes, 0);
  assert.equal(closedVote.state.reports.find(report => report.id === "new-issue").title, "Another blocked drain");
});

test("nearby-location match points are limited to the same campus", async () => {
  const database = readDatabase();
  const foundReport = database.reports.find(report => report.id === "found-1");
  foundReport.campusId = "other-campus";
  writeDatabase(database);
  let state = await request("/api/state", fixture.tokens.student);
  state.reports.push({
    id: "lost-other-campus", type: "lost", title: "Red wallet", category: "Wallet",
    place: "Hightech Railway Station", date: new Date().toISOString().slice(0, 10),
    text: "golden zipper", status: "Open", priority: "Medium", consent: true
  });
  await request("/api/state", fixture.tokens.student, state);
  let student = await request("/api/state", fixture.tokens.student);
  assert.equal(student.notifications.some(item => item.refId === "lost-other-campus" && item.text.includes("possible match")), false);

  const updatedDatabase = readDatabase();
  updatedDatabase.reports.find(report => report.id === "found-1").campusId = "uftb-main";
  writeDatabase(updatedDatabase);
  student.reports.push({
    id: "lost-nearby-campus", type: "lost", title: "Another red wallet", category: "Wallet",
    place: "Hightech Railway Station", date: new Date().toISOString().slice(0, 10),
    text: "golden zipper", status: "Open", priority: "Medium", consent: true
  });
  await request("/api/state", fixture.tokens.student, student);
  student = await request("/api/state", fixture.tokens.student);
  assert(student.notifications.some(item => item.refId === "lost-nearby-campus" && item.text.includes("possible match")));
});

test("lost and found descriptions can match using Bangla keywords", async () => {
  const admin = await request("/api/state", fixture.tokens.admin);
  admin.reports.find(report => report.id === "found-1").text = "মানিব্যাগ নীল চাবি";
  await request("/api/state", fixture.tokens.admin, admin);
  const state = await request("/api/state", fixture.tokens.student);
  const lostDate = new Date();
  lostDate.setDate(lostDate.getDate() - 10);
  state.reports.push({
    id: "lost-bangla-match", type: "lost", title: "Bangla keyword match", category: "Wallet",
    place: "Hightech", date: lostDate.toISOString().slice(0, 10),
    text: "মানিব্যাগ নীল চাবি", consent: true
  });
  await request("/api/state", fixture.tokens.student, state);
  const updated = await request("/api/state", fixture.tokens.student);
  assert(updated.notifications.some(item => item.refId === "lost-bangla-match" && item.text.includes("possible match")));
});

test("report map pins are limited to Bangladesh coordinates", async () => {
  const state = await request("/api/state", fixture.tokens.student);
  state.reports.push({
    id: "dhaka-map-pin", type: "lost", title: "Map pin test", category: "Bag",
    place: "Dhaka", date: new Date().toISOString().slice(0, 10), text: "Test report",
    latitude: 23.8103, longitude: 90.4125, consent: true
  });
  const saved = await request("/api/state", fixture.tokens.student, state);
  const dhakaPin = saved.state.reports.find(report => report.id === "dhaka-map-pin");
  assert.equal(dhakaPin.latitude, 23.8103);
  assert.equal(dhakaPin.longitude, 90.4125);

  const outsideBangladesh = await request("/api/state", fixture.tokens.student, {
    ...saved.state,
    reports: [...saved.state.reports, {
      id: "outside-bangladesh-pin", type: "lost", title: "Outside Bangladesh pin", category: "Bag",
      place: "West Bengal", date: new Date().toISOString().slice(0, 10), text: "Test report",
      latitude: 24.9, longitude: 88.1, consent: true
    }]
  }, 400);
  assert.match(outsideBangladesh.error, /invalid or duplicate report data/i);

  const invalidLatitude = await request("/api/state", fixture.tokens.student, {
    ...saved.state,
    reports: [...saved.state.reports, {
      id: "invalid-latitude-pin", type: "lost", title: "Invalid latitude pin", category: "Bag",
      place: "Invalid coordinates", date: new Date().toISOString().slice(0, 10), text: "Test report",
      latitude: 91, longitude: 88.3639, consent: true
    }]
  }, 400);
  assert.match(invalidLatitude.error, /invalid or duplicate report data/i);
  const invalidLongitude = await request("/api/state", fixture.tokens.student, {
    ...saved.state,
    reports: [...saved.state.reports, {
      id: "invalid-longitude-pin", type: "lost", title: "Invalid longitude pin", category: "Bag",
      place: "Invalid coordinates", date: new Date().toISOString().slice(0, 10), text: "Test report",
      latitude: 22.5726, longitude: -181, consent: true
    }]
  }, 400);
  assert.match(invalidLongitude.error, /invalid or duplicate report data/i);
  const invalidDate = await request("/api/state", fixture.tokens.student, {
    ...saved.state,
    reports: [...saved.state.reports, {
      id: "invalid-calendar-date", type: "lost", title: "Invalid date", category: "Bag",
      place: "Dhaka", date: "2026-02-31", text: "Test report", consent: true
    }]
  }, 400);
  assert.match(invalidDate.error, /invalid or duplicate report data/i);
});
