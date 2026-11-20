const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { frontendRoot, assetsRoot, reportRetentionDays, privacyNoticeVersion } = require("./config");
const { readDb, writeDb, uploadImage, readUpload, deleteUpload } = require("./database");
const { send, readRequestBody, imageType } = require("./http-utils");
const { publicDb, mergeState } = require("./report-state");
const auth = require("./auth");
const {
  sessions, passwordResetEmailReady, authenticatedUser, rateLimited, loginUser, registerUser,
  createPasswordReset, sendPasswordResetEmail, deletePasswordReset, resetPassword
} = auth;
const { historyEntry, addNotification, trustLevel } = require("./report-matching");
const { searchBangladeshLocations } = require("./location-search");

function readJson(req, res, maxLength, handler, fallback) {
  readRequestBody(req, maxLength, async raw => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      const message = fallback === undefined ? error.message : error.message || fallback;
      return send(res, 400, { ok: false, error: message });
    }
    try {
      await handler(body);
    } catch (error) {
      if (error.code !== "PERSISTENCE_ERROR") {
        return send(res, 400, { ok: false, error: fallback === undefined ? error.message : error.message || fallback });
      }
      console.error("API request failed:", error.message);
      if (!res.headersSent) send(res, 503, { ok: false, error: "Data storage is temporarily unavailable. Try again later." });
    }
  });
}

module.exports = function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, service: "LostTrack API" });
  if (url.pathname === "/api/location-search" && req.method === "GET") {
    const user = authenticatedUser(req);
    if (!user || !["user", "staff", "admin"].includes(user.role)) return send(res, 401, { ok: false, error: "Sign in to search locations." });
    const query = url.searchParams.get("q")?.trim() || "";
    if (query.length < 3 || query.length > 120) return send(res, 400, { ok: false, error: "Enter 3 to 120 characters to search for a location." });
    searchBangladeshLocations(query).then(result => {
      if (result.retryAfter) {
        return send(res, 429, { ok: false, error: "Please wait a moment before searching again." }, "application/json", {
          "Retry-After": String(result.retryAfter)
        });
      }
      send(res, 200, { ok: true, results: result.results });
    }).catch(error => {
      console.error("Bangladesh location search failed:", error.message);
      send(res, 502, { ok: false, error: "Location search is temporarily unavailable. Try again later." });
    });
    return;
  }
  if (["/api/login", "/api/register", "/api/forgot-password", "/api/reset-password"].includes(url.pathname) && req.method === "POST") {
    if (rateLimited(req)) return send(res, 429, { ok: false, error: "Too many attempts. Try again later." });
    readRequestBody(req, 20_000, async raw => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { ok: false, error: "Invalid login request." });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return send(res, 400, { ok: false, error: "Invalid login request." });
      }
      try {
        if (url.pathname === "/api/register") {
          const result = await registerUser(body.name || "", body.email || "", body.password || "", body.role || "user", body.privacyConsent === true);
          if (result && result !== "pending") return send(res, 400, { ok: false, error: result });
          const message = result === "pending"
            ? "Staff account request submitted. An administrator must approve your account."
            : "Student account created. You can now sign in.";
          return send(res, 201, { ok: true, pending: result === "pending", message });
        }
        if (url.pathname === "/api/forgot-password") {
          if (!passwordResetEmailReady) return send(res, 503, { ok: false, error: "Password-reset email is not configured. Contact the administrator." });
          const reset = await createPasswordReset(body.email || "");
          if (reset) {
            try {
              await sendPasswordResetEmail(String(body.email).toLowerCase(), reset.token);
            } catch (error) {
              await deletePasswordReset(reset.key);
              console.error("Password-reset email delivery failed:", error.message);
              return send(res, 503, { ok: false, error: "The reset email could not be sent. Please try again later." });
            }
          }
          return send(res, 200, {
            ok: true,
            message: "If an account exists for this email, a password-reset link has been sent."
          });
        }
        if (url.pathname === "/api/reset-password") {
          const error = await resetPassword(body.token || "", body.password || "");
          if (error) return send(res, 400, { ok: false, error });
          return send(res, 200, { ok: true, message: "Password updated. You can now sign in." });
        }
        const user = loginUser(body.email || "", body.password || "");
        if (!user) return send(res, 401, { ok: false, error: "Invalid university email or password." });
        if (user.error) return send(res, 403, { ok: false, error: user.error });
        send(res, 200, { ok: true, user });
      } catch (error) {
        console.error("Authentication request failed:", error.message);
        if (!res.headersSent) {
          const storageUnavailable = error.code === "PERSISTENCE_ERROR";
          send(res, storageUnavailable ? 503 : 500, {
            ok: false,
            error: storageUnavailable
              ? "Data storage is temporarily unavailable. Try again later."
              : "The authentication request could not be completed. Try again."
          });
        }
      }
    });
    return;
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) sessions.delete(header.slice(7));
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/admin/accounts" && req.method === "GET") {
    const user = authenticatedUser(req);
    if (!user || user.role !== "admin") return send(res, 403, { ok: false, error: "Administrator access required." });
    const accounts = readDb().accounts.map(({ id, name, email, role, requestedRole, status, createdAt, campusId }) => ({
      id, name, email, role, requestedRole, status, createdAt, campusId
    }));
    return send(res, 200, { accounts });
  }
  const reportDelete = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
  if (reportDelete && req.method === "DELETE") {
    const user = authenticatedUser(req);
    if (!user || user.role !== "admin") return send(res, 403, { ok: false, error: "Administrator access required." });
    let reportId;
    try {
      reportId = decodeURIComponent(reportDelete[1]);
    } catch {
      return send(res, 400, { ok: false, error: "Invalid report ID." });
    }
    (async () => {
      const db = readDb();
      const report = db.reports.find(item => String(item.id) === reportId);
      if (!report) return send(res, 404, { ok: false, error: "Report not found." });
      const photos = (report.photos || [])
        .map(photo => path.basename(String(photo)))
        .filter(name => /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(name));
      db.reports = db.reports.filter(item => String(item.id) !== reportId);
      db.claims = db.claims.filter(item => String(item.reportId) !== reportId);
      db.privateClues = db.privateClues.filter(item => String(item.reportId) !== reportId);
      db.tasks = db.tasks.filter(item => String(item.reportId) !== reportId);
      db.notifications = db.notifications.map(item =>
        String(item.refId) === reportId ? { ...item, refId: null } : item);
      for (const item of db.reports) {
        if (String(item.duplicateOf) === reportId) delete item.duplicateOf;
      }
      await writeDb(db);
      let cleanupFailed = false;
      for (const photo of photos) {
        try {
          await deleteUpload(photo);
        } catch (error) {
          cleanupFailed = true;
          console.error(`Image cleanup failed for report ${reportId}:`, error.message);
        }
      }
      if (cleanupFailed) {
        return send(res, 503, { ok: false, error: "Report data was deleted, but some attached images could not be removed. Contact the administrator." });
      }
      send(res, 200, { ok: true, state: publicDb(db, user) });
    })().catch(error => {
      console.error("Report deletion failed:", error.message);
      if (!res.headersSent) send(res, error.code === "PERSISTENCE_ERROR" ? 503 : 500, {
        ok: false,
        error: error.code === "PERSISTENCE_ERROR"
          ? "Data storage is temporarily unavailable. Try again later."
          : "The report could not be deleted. Try again."
      });
    });
    return;
  }
  if (url.pathname === "/api/admin/accounts/approve" && req.method === "POST") {
    const user = authenticatedUser(req);
    if (!user || user.role !== "admin") return send(res, 403, { ok: false, error: "Administrator access required." });
    readJson(req, res, 10_000, async body => {
      const db = readDb();
      const account = db.accounts.find(item => item.email === String(body.email || "").toLowerCase() && item.status === "pending" && item.requestedRole === "staff");
      if (!account) return send(res, 404, { ok: false, error: "Pending account not found." });
      account.role = account.requestedRole;
      account.status = "active";
      await writeDb(db);
      send(res, 200, { ok: true, message: "Account approved." });
    }, "Invalid approval request.");
    return;
  }
  if (url.pathname === "/api/state" && req.method === "GET") {
    const user = authenticatedUser(req);
    if (!user) return send(res, 401, { ok: false, error: "Authentication required." });
    return send(res, 200, publicDb(readDb(), user));
  }
  if (url.pathname === "/api/claims" && req.method === "POST") {
    const user = authenticatedUser(req);
    if (!user || !["user", "staff"].includes(user.role)) return send(res, 403, { ok: false, error: "Student or Staff access required." });
    readJson(req, res, 10_000, async body => {
      const detail = typeof body.detail === "string" ? body.detail.trim() : "";
      if (body.consent !== true) return send(res, 400, { ok: false, error: "Consent is required before submitting a claim." });
      if (!detail || detail.length > 300) return send(res, 400, { ok: false, error: "Enter private ownership details (up to 300 characters)." });
      const db = readDb();
      const report = db.reports.find(item => String(item.id) === String(body.reportId));
      if (!report || report.type !== "found" || report.status !== "Found") return send(res, 404, { ok: false, error: "This found item is no longer available for claims." });
      if (report.createdBy === user.id) return send(res, 403, { ok: false, error: "You cannot claim an item you reported." });
      if (db.claims.some(claim => String(claim.reportId) === String(report.id) && claim.status === "Approved")) {
        return send(res, 409, { ok: false, error: "A claim has already been approved for this item." });
      }
      if (body.claimId) {
        const claim = db.claims.find(item =>
          item.id === body.claimId && String(item.reportId) === String(report.id) &&
          item.claimantId === user.id && item.status === "Needs more information");
        if (!claim) return send(res, 409, { ok: false, error: "This claim is not waiting for more information." });
        const now = new Date().toISOString();
        claim.detail = `${claim.detail}\n\nAdditional information: ${detail}`;
        claim.status = "Pending review";
        claim.additionalConsentAt = now;
        claim.additionalConsentVersion = privacyNoticeVersion;
        claim.updatedAt = now;
        delete claim.reviewedBy;
        delete claim.reviewedAt;
        report.history = [...(report.history || []), historyEntry(user, `Additional information submitted for claim attempt ${claim.attemptNo}`)];
        addNotification(db, db.accounts.find(item => item.role === "admin")?.id, `Additional information was submitted for the claim on "${report.title}".`, report.id);
        await writeDb(db);
        return send(res, 200, { ok: true, state: publicDb(db, user) });
      }
      const claims = db.claims.filter(claim => String(claim.reportId) === String(report.id) && claim.claimantId === user.id);
      const usedAttempts = claims.length - claims.filter(claim => claim.reopened).length;
      if (usedAttempts >= 3) return send(res, 409, { ok: false, error: "This item has reached the three-claim limit. Ask an administrator to reopen an attempt." });
      if (claims.length && claims[claims.length - 1].status !== "Rejected") {
        return send(res, 409, { ok: false, error: "Your previous claim must be rejected before another attempt." });
      }
      const now = new Date().toISOString();
      const claim = {
        id: `${report.id}_${user.id}_${claims.length + 1}`,
        reportId: report.id,
        claimantId: user.id,
        detail,
        attemptNo: claims.length + 1,
        trustLevel: trustLevel(db, user.id),
        status: "Pending review",
        consentAt: now,
        consentVersion: privacyNoticeVersion,
        campusId: "uftb-main",
        createdAt: now
      };
      db.claims.push(claim);
      report.history = [...(report.history || []), historyEntry(user, `Claim attempt ${claim.attemptNo} submitted`)];
      addNotification(db, db.accounts.find(item => item.role === "admin")?.id, `A claim for "${report.title}" is ready for review.`, report.id);
      await writeDb(db);
      send(res, 201, { ok: true, state: publicDb(db, user) });
  }, "Invalid claim request.");
  return;
}
if (url.pathname === "/api/admin/claims/reopen" && req.method === "POST") {
  const user = authenticatedUser(req);
  if (!user || user.role !== "admin") return send(res, 403, { ok: false, error: "Administrator access required." });
  readJson(req, res, 10_000, async body => {
    const db = readDb();
    const claim = db.claims.find(item => item.id === body.claimId && item.status === "Rejected");
    if (!claim) return send(res, 404, { ok: false, error: "Rejected claim not found." });
    const report = db.reports.find(item => String(item.id) === String(claim.reportId));
    if (!report || report.type !== "found" || report.status !== "Found") {
      return send(res, 409, { ok: false, error: "Claims can only be reopened while the found item is available." });
    }
    const relatedClaims = db.claims.filter(item => String(item.reportId) === String(claim.reportId) && item.claimantId === claim.claimantId);
    const latest = relatedClaims[relatedClaims.length - 1];
    const usedAttempts = relatedClaims.length - relatedClaims.filter(item => item.reopened).length;
    if (latest?.id !== claim.id || claim.reopened || usedAttempts < 3) {
      return send(res, 409, { ok: false, error: "Only the latest rejected claim can be reopened after three attempts." });
    }
    claim.reopened = true;
    claim.reopenedAt = new Date().toISOString();
    claim.reopenedBy = user.id;
    report.history = [...(report.history || []), historyEntry(user, `Claim attempt reopened for ${claim.claimantId}`)];
    addNotification(db, claim.claimantId, `An additional claim attempt has been reopened for "${report.title}".`, claim.reportId);
    await writeDb(db);
    send(res, 200, { ok: true, state: publicDb(db, user) });
}, "Invalid claim reopen request.");
return;
}
if (url.pathname === "/api/vote" && req.method === "POST") {
const user = authenticatedUser(req);
if (!user) return send(res, 401, { ok: false, error: "Authentication required." });
if (!["user", "staff"].includes(user.role)) return send(res, 403, { ok: false, error: "Student or Staff access required to upvote." });
readJson(req, res, 10_000, async body => {
  const db = readDb();
  const report = db.reports.find(item => String(item.id) === String(body.reportId));
  if (!report || report.type !== "issue") return send(res, 404, { ok: false, error: "Campus issue not found." });
  if (report.status !== "Open") return send(res, 409, { ok: false, error: "Only open issues can receive upvotes." });
  report.votedBy = Array.isArray(report.votedBy) ? report.votedBy : [];
  if (report.votedBy.includes(user.id)) return send(res, 409, { ok: false, error: "You have already voted on this report." });
  report.votedBy.push(user.id);
  report.votes = report.votedBy.length;
  report.updatedAt = new Date().toISOString();
  report.history = [...(report.history || []), historyEntry(user, "Upvoted this campus issue")];
  await writeDb(db);
  send(res, 200, { ok: true, state: publicDb(db, user) });
}, "Invalid vote request.");
return;
}
if (url.pathname === "/api/state" && req.method === "POST") {
readJson(req, res, 2_000_000, async incoming => {
const user = authenticatedUser(req);
if (!user) return send(res, 401, { ok: false, error: "Authentication required." });
const current = readDb();
const updated = mergeState(current, incoming, user);
await writeDb(updated);
send(res, 200, { ok: true, state: publicDb(updated, user) });
    });
    return;
  }
  if (url.pathname === "/api/uploads" && req.method === "POST") {
    const user = authenticatedUser(req);
    if (!user || !["user", "staff", "admin"].includes(user.role)) return send(res, 403, { ok: false, error: "Report upload access required." });
    readRequestBody(req, 9_000_000, async raw => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { ok: false, error: "Invalid image upload." });
      }
      if (!body || !Array.isArray(body.files) || body.files.length > 3) return send(res, 400, { ok: false, error: "Upload up to 3 images." });
      let prepared;
      try {
        prepared = body.files.map(file => {
          if (!file || typeof file.data !== "string" || file.data.length > 2_800_000) throw new Error("Each image must be 2 MB or smaller.");
          const bytes = Buffer.from(file.data, "base64");
          if (bytes.length > 2 * 1024 * 1024) throw new Error("Each image must be 2 MB or smaller.");
          const type = imageType(bytes);
          if (!type) throw new Error("Image signature must match a JPG, PNG, or WebP file.");
          return { bytes, type };
        });
      } catch (error) {
        send(res, 400, { ok: false, error: error.message || "Invalid image upload." });
        return;
      }
      const savedNames = [];
      const urls = [];
      try {
        for (const { bytes, type } of prepared) {
          const name = `${crypto.randomUUID()}.${type.ext}`;
          await uploadImage(name, bytes, type.mime);
          savedNames.push(name);
          urls.push(`/uploads/${name}`);
        }
      } catch (error) {
        for (const name of savedNames) {
          try {
            await deleteUpload(name);
          } catch (cleanupError) {
            console.error("Uploaded image cleanup failed:", cleanupError.message);
          }
        }
        console.error("Image storage failed:", error.message);
        send(res, 503, { ok: false, error: "Image storage is temporarily unavailable. Try again later." });
        return;
      }
      send(res, 201, { ok: true, urls });
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/") && req.method === "GET") {
    const name = url.pathname.slice("/uploads/".length);
    if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(name)) return send(res, 404, { error: "Not found" });
    readUpload(name).then(image => {
      if (!image) return send(res, 404, { error: "Not found" });
      const type = imageType(image);
      if (!type) return send(res, 404, { error: "Not found" });
      res.writeHead(200, {
        "Content-Type": type.mime,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cache-Control": "public, max-age=86400"
      });
      res.end(image);
    }).catch(error => {
      console.error("Image retrieval failed:", error.message);
      if (!res.headersSent) send(res, 503, { error: "Image storage is temporarily unavailable." });
    });
    return;
  }
  const assetRequest = url.pathname.startsWith("/assets/");
  const base = assetRequest ? assetsRoot : frontendRoot;
  const file = assetRequest ? url.pathname.slice("/assets/".length) : (url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  const filePath = path.resolve(base, file);
  if ((filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, { error: "Not found" });
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
  let content = fs.readFileSync(filePath);
  if (!assetRequest && file === "index.html") {
    content = content.toString("utf8").replace(
      '<meta name="losttrack-retention-days" content="30">',
      `<meta name="losttrack-retention-days" content="${reportRetentionDays}">`
    );
  }
  send(res, 200, content, types[path.extname(filePath)] || "application/octet-stream",
    assetRequest ? { "Cache-Control": "public, max-age=300" } : {});

};
