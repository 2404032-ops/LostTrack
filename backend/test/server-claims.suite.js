const fixture = require("./server-fixture");
const { assert, crypto, fs, os, path, spawnSync, vm, password, root, request, login, readDatabase, writeDatabase, unusedPort } = fixture;
const { test } = require("node:test");

test("claims require consent, stay private, and allow only an administrator-reopened extra attempt", async () => {
  let state = await request("/api/state", fixture.tokens.student);
  state.reports.find(report => report.id === "found-1").claimDetail = "State payload must not create a claim";
  state = (await request("/api/state", fixture.tokens.student, state)).state;
  assert.equal(state.claims.length, 0);
  assert.equal(state.reports.find(report => report.id === "found-1").claimDetail, undefined);
  await request("/api/claims", fixture.tokens.student, { reportId: "found-1", detail: "No consent", consent: false }, 400);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await request("/api/claims", fixture.tokens.student, {
      reportId: "found-1",
      detail: `Owner detail ${attempt}`,
      consent: true
    }, 201);
    state = result.state;
    assert.equal(state.claims.length, attempt);
    assert.equal(state.claims[attempt - 1].attemptNo, attempt);
    assert.equal(state.claims[attempt - 1].detail, undefined);
    assert.equal(state.claims[attempt - 1].consentVersion, "1.0");
    assert.equal(state.reports.find(report => report.id === "found-1").claimDetail, undefined);
    if (attempt < 3) {
      const adminReview = await request("/api/state", fixture.tokens.admin);
      adminReview.claims[attempt - 1].status = attempt === 1 ? "Needs more information" : "Rejected";
      await request("/api/state", fixture.tokens.admin, adminReview);
      if (attempt === 1) {
        state = await request("/api/state", fixture.tokens.student);
        const waiting = state.claims.find(claim => claim.attemptNo === attempt);
        assert.equal(waiting.status, "Needs more information");
        await request("/api/claims", fixture.tokens.student, {
          reportId: "found-1", claimId: "stale-claim", detail: "Stale response", consent: true
        }, 409);
        await request("/api/claims", fixture.tokens.student, {
          reportId: "found-1", claimId: waiting.id, detail: "No consent", consent: false
        }, 400);
        const supplemental = await request("/api/claims", fixture.tokens.student, {
          reportId: "found-1", claimId: waiting.id, detail: "The lining has a blue stitch.", consent: true
        });
        assert.equal(supplemental.state.claims[0].status, "Pending review");
        assert.equal(supplemental.state.claims[0].attemptNo, attempt);
        assert.equal(supplemental.state.claims[0].detail, undefined);
        const updatedClaim = await request("/api/state", fixture.tokens.admin);
        assert.match(updatedClaim.claims[0].detail, /The lining has a blue stitch/);
        assert.equal(updatedClaim.claims[0].additionalConsentVersion, "1.0");
        updatedClaim.claims[0].status = "Rejected";
        await request("/api/state", fixture.tokens.admin, updatedClaim);
      }
      state = await request("/api/state", fixture.tokens.student);
    }
  }
  await request("/api/claims", fixture.tokens.student, { reportId: "found-1", detail: "Fourth guess", consent: true }, 409);
  const admin = await request("/api/state", fixture.tokens.admin);
  assert.equal(admin.claims.length, 3);
  assert.equal(admin.claims[0].detail, "Owner detail 1\n\nAdditional information: The lining has a blue stitch.");
  admin.claims.forEach(claim => { claim.status = "Rejected"; });
  const decision = await request("/api/state", fixture.tokens.admin, admin);
  assert.equal(decision.state.claims[0].status, "Rejected");
  await request("/api/admin/claims/reopen", fixture.tokens.student, { claimId: admin.claims[2].id }, 403);
  await request("/api/admin/claims/reopen", fixture.tokens.admin, { claimId: admin.claims[0].id }, 409);
  const reopened = await request("/api/admin/claims/reopen", fixture.tokens.admin, { claimId: admin.claims[2].id });
  assert.equal(reopened.state.claims[2].reopened, true);
  const claimant = await request("/api/state", fixture.tokens.student);
  assert(claimant.notifications.some(notification => notification.text.includes("claim") && notification.text.includes("rejected")));
  assert(claimant.notifications.every(notification => !notification.text.includes("Owner detail")));
  const fourth = await request("/api/claims", fixture.tokens.student, { reportId: "found-1", detail: "Owner detail four", consent: true }, 201);
  assert.equal(fourth.state.claims[3].attemptNo, 4);
  await request("/api/claims", fixture.tokens.student, { reportId: "found-1", detail: "Fifth guess", consent: true }, 409);
  assert.equal((await request("/api/state", fixture.tokens.admin)).claims.length, 4);
  const staffClaim = await request("/api/claims", fixture.tokens.staff, { reportId: "found-1", detail: "Staff ownership detail", consent: true }, 201);
  assert.equal(staffClaim.state.claims.length, 1);
  assert.equal((await request("/api/state", fixture.tokens.student)).claims.length, 4);
  let review = await request("/api/state", fixture.tokens.admin);
  review.claims.find(claim => claim.id === fourth.state.claims[3].id).status = "Approved";
  await request("/api/state", fixture.tokens.admin, review);
  await request("/api/claims", fixture.tokens.staff, {
    reportId: "found-1", detail: "Another ownership detail", consent: true
  }, 409);
  review = await request("/api/state", fixture.tokens.admin);
  review.claims.find(claim => claim.claimantId === fixture.users.staff.id).status = "Approved";
  const secondApproval = await request("/api/state", fixture.tokens.admin, review, 400);
  assert.match(secondApproval.error, /already been approved/i);
});
