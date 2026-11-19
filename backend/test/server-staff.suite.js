const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("staff can report, vote, claim, and progress only assigned tasks", async () => {
  let state = await request("/api/state", fixture.tokens.staff);
  state.reports.find(report => report.id === "issue-1").status = "Returned";
  state.reports.find(report => report.id === "issue-1").title = "Forged staff edit";
  state.reports.push({
    id: "staff-issue", type: "issue", title: "Staff reported hazard", category: "Waste",
    place: "Courtyard", date: new Date().toISOString().slice(0, 10), text: "Overflowing bin",
    consent: true
  });
  state.tasks.find(task => task.id === "task-staff").status = "In progress";
  state.tasks.push({ id: "task-other", status: "Completed" });
  let result = await request("/api/state", fixture.tokens.staff, state);
  assert.equal(result.state.reports.find(report => report.id === "issue-1").status, "Open");
  assert.equal(result.state.reports.find(report => report.id === "issue-1").title, "Blocked drain");
  assert.equal(result.state.reports.find(report => report.id === "staff-issue").createdBy, fixture.users.staff.id);
  assert.equal(result.state.tasks.length, 1);
  const staffVote = await request("/api/vote", fixture.tokens.staff, { reportId: "staff-issue" });
  assert.equal(staffVote.state.reports.find(report => report.id === "staff-issue").votes, 1);
  assert.equal(result.state.tasks[0].status, "In progress");
  result.state.tasks[0].status = "Completed";
  result = await request("/api/state", fixture.tokens.staff, result.state);
  assert.equal(result.state.tasks[0].status, "Completed");
  result.state.tasks[0].status = "Assigned";
  result = await request("/api/state", fixture.tokens.staff, result.state);
  assert.equal(result.state.tasks[0].status, "Completed");
  assert(result.state.reports.find(report => report.id === "issue-1").history.some(entry => entry.includes("Task completed")));
});
