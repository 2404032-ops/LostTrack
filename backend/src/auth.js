const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
const { port, privacyNoticeVersion } = require("./config");
const { readDb, writeDb } = require("./database");
const { validUniversityEmail } = require("./report-matching");
const sessions = new Map();
const loginAttempts = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
const brevoApiKey = process.env.BREVO_API_KEY?.trim();
const brevoSenderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
const brevoReady = Boolean(brevoApiKey && brevoSenderEmail);
const emailReady = smtpReady || brevoReady;
const mailer = smtpReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  requireTLS: process.env.SMTP_SECURE !== "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

function isStrongPassword(password) {
  return typeof password === "string" && password.length >= 12 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) &&
    /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function hasVerifiedUniversityEmail(db, user) {
  return db.accounts.some(account => account.id === user.id && account.emailVerified === true);
}

function hasUnverifiedContribution(db, incoming, user) {
  if (user.role === "admin") return false;
  const existingReports = new Map(db.reports.map(report => [String(report.id), report]));
  const editableFields = ["title", "category", "place", "date", "color", "text", "photos", "latitude", "longitude"];
  for (const update of incoming.reports) {
    const report = existingReports.get(String(update.id));
    if (!report) return true;
    if (report.createdBy === user.id && ["Open", "Found"].includes(report.status) &&
      editableFields.some(key => update[key] !== undefined && JSON.stringify(update[key]) !== JSON.stringify(report[key]))) return true;
    if (report.type === "issue" && report.status === "Open" && update.voted &&
      !(report.votedBy || []).includes(user.id)) return true;
  }
  if (user.role === "staff") {
    return incoming.tasks.some(update => db.tasks.some(task =>
      task.id === update.id && task.assigneeEmail === user.email && task.status !== update.status));
  }
  return false;
}

function emailTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function loginUser(email, password) {
  const db = readDb();
  const account = db.accounts.find(item => item.email === email.toLowerCase());
  if (account && account.status === "pending") return { error: `This ${account.requestedRole === "staff" ? "Staff" : "Administrator"} account is waiting for approval.` };
  if (!isStrongPassword(password) || !account || !passwordMatches(password, account.passwordHash)) return null;
  const token = crypto.randomUUID();
  sessions.set(token, { id: account.id, email: email.toLowerCase(), role: account.role, name: account.name, expiresAt: Date.now() + sessionLifetime });
  return { token, id: account.id, email: email.toLowerCase(), role: account.role, name: account.name, emailVerified: Boolean(account.emailVerified) };
}

async function registerUser(name, email, password, requestedRole = "user", privacyConsent = false) {
  const normalizedEmail = email.toLowerCase();
  if (!name || name.trim().length < 2 || name.trim().length > 80) return "Enter a valid name.";
  if (!validUniversityEmail(normalizedEmail)) return "Use a valid @uftb.ac.bd university email.";
  if (!isStrongPassword(password)) return "Password must be 12+ characters with uppercase, lowercase, a number and a symbol.";
  if (!["user", "staff"].includes(requestedRole)) return "Choose Student or Staff.";
  if (privacyConsent !== true) return "Consent to the privacy notice is required to create an account.";
  const db = readDb();
  if (db.accounts.some(account => account.email === normalizedEmail)) return "An account with this email already exists.";
  db.accounts.push({
    id: crypto.randomUUID(), name: name.trim(), email: normalizedEmail,
    role: "user", requestedRole, status: requestedRole === "user" ? "active" : "pending",
    passwordHash: hashPassword(password), emailVerified: false, privacyConsentAt: new Date().toISOString(),
    privacyConsentVersion: privacyNoticeVersion, campusId: "uftb-main", createdAt: new Date().toISOString()
  });
  await writeDb(db);
  if (requestedRole === "user") return null;
  return "pending";
}

async function provisionInitialAdmin() {
  const email = process.env.LOSTTRACK_INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || "";
  const password = process.env.LOSTTRACK_INITIAL_ADMIN_PASSWORD || "";
  if (!email && !password) {
    const db = readDb();
    if (!db.accounts.some(account => account.role === "admin" && account.status === "active")) {
      console.warn("No active administrator exists. Configure LOSTTRACK_INITIAL_ADMIN_EMAIL and LOSTTRACK_INITIAL_ADMIN_PASSWORD to provision one.");
    }
    return;
  }
  if (!email || !password) throw new Error("Set both LOSTTRACK_INITIAL_ADMIN_EMAIL and LOSTTRACK_INITIAL_ADMIN_PASSWORD to provision the first administrator.");
  const db = readDb();
  if (db.accounts.some(account => account.role === "admin" && account.status === "active")) return;
  if (!validUniversityEmail(email)) throw new Error("LOSTTRACK_INITIAL_ADMIN_EMAIL must be a valid @uftb.ac.bd address.");
  if (!isStrongPassword(password)) throw new Error("LOSTTRACK_INITIAL_ADMIN_PASSWORD must be 12+ characters with uppercase, lowercase, a number and a symbol.");
  if (db.accounts.some(account => account.email === email)) throw new Error("The initial administrator email already belongs to another account.");
  const name = (process.env.LOSTTRACK_INITIAL_ADMIN_NAME || "Main Admin").trim();
  if (name.length < 2 || name.length > 80) throw new Error("LOSTTRACK_INITIAL_ADMIN_NAME must be 2 to 80 characters.");
  const now = new Date().toISOString();
  db.accounts.push({
    id: crypto.randomUUID(), name, email, role: "admin", requestedRole: "admin", status: "active",
    emailVerified: true, passwordHash: hashPassword(password), campusId: "uftb-main", createdAt: now
  });
  await writeDb(db);
  console.log(`Initial administrator provisioned for ${email}. Remove the bootstrap credentials from the environment.`);
}

function activePasswordResets(db) {
  const now = Date.now();
  return (Array.isArray(db.passwordResets) ? db.passwordResets : []).filter(item =>
    item && typeof item.tokenHash === "string" && typeof item.accountId === "string" && Number(item.expiresAt) > now);
}

async function createPasswordReset(email) {
  const db = readDb();
  const account = db.accounts.find(item => item.email === email.toLowerCase());
  if (!account) return null;
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPassword(token);
  db.passwordResets = activePasswordResets(db).filter(item => item.accountId !== account.id);
  db.passwordResets.push({ tokenHash, accountId: account.id, expiresAt: Date.now() + 15 * 60 * 1000 });
  await writeDb(db);
  return { token, key: tokenHash };
}

async function deletePasswordReset(tokenHash) {
  const db = readDb();
  db.passwordResets = activePasswordResets(db).filter(item => item.tokenHash !== tokenHash);
  await writeDb(db);
}

async function createEmailVerification(email) {
  const db = readDb();
  const account = db.accounts.find(item => item.email === email.toLowerCase());
  if (!account || account.emailVerified) return null;
  const token = crypto.randomBytes(32).toString("hex");
  account.emailVerificationTokenHash = emailTokenHash(token);
  account.emailVerificationExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  await writeDb(db);
  return { token, accountId: account.id, email: account.email };
}

async function sendOneTimeEmail(email, token, queryKey, subject, instruction, linkText, warning) {
  const baseUrl = emailBaseUrl();
  const link = new URL("/", baseUrl);
  link.searchParams.set(queryKey, token);
  const url = link.toString();
  const text = `${instruction}\n\n${url}\n\n${warning}`;
  const html = `<p>${instruction}</p><p><a href="${url}">${linkText}</a></p><p>${warning}</p>`;
  if (brevoReady) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevoApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME || "LostTrack",
          email: brevoSenderEmail
        },
        to: [{ email }],
        subject,
        textContent: text,
        htmlContent: html
      })
    });
    if (!response.ok) throw new Error(`Brevo email API returned HTTP ${response.status}.`);
    return;
  }
  if (!mailer) throw new Error("Email delivery is not configured.");
  await mailer.sendMail({ from: process.env.SMTP_FROM, to: email, subject, text, html });
}

function emailBaseUrl(environment = process.env, serverPort = port) {
  const configuredUrl = environment.APP_BASE_URL?.trim();
  const deployedUrl = environment.RENDER_EXTERNAL_URL?.trim();
  let configuredHost = "";
  if (configuredUrl) {
    try {
      configuredHost = new URL(configuredUrl).hostname.toLowerCase();
    } catch {
      throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
    }
  }
  const isLocalUrl = ["localhost", "127.0.0.1", "::1"].includes(configuredHost);
  const baseUrl = deployedUrl && isLocalUrl
    ? deployedUrl
    : isLocalUrl
      ? `http://localhost:${serverPort}`
      : configuredUrl || deployedUrl || `http://localhost:${serverPort}`;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
  return baseUrl;
}

function sendEmailVerification(email, token) {
  return sendOneTimeEmail(email, token, "verify-token", "Verify your LostTrack university email",
    "Use this one-time link within 24 hours to verify your LostTrack account:", "Verify email",
    "If you did not create this account, ignore this email.");
}

async function verifyEmail(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const db = readDb();
  const tokenHash = emailTokenHash(token);
  const account = db.accounts.find(item => item.emailVerificationTokenHash === tokenHash &&
    Number(item.emailVerificationExpiresAt) > Date.now());
  if (!account) return null;
  account.emailVerified = true;
  account.emailVerifiedAt = new Date().toISOString();
  delete account.emailVerificationTokenHash;
  delete account.emailVerificationExpiresAt;
  await writeDb(db);
  for (const session of sessions.values()) if (session.id === account.id) session.emailVerified = true;
  return account.email;
}

function sendPasswordResetEmail(email, token) {
  return sendOneTimeEmail(email, token, "reset-token", "Reset your LostTrack password",
    "Use this one-time link within 15 minutes to reset your LostTrack password:", "Reset password",
    "If you did not request this, ignore this email.");
}

async function resetPassword(token, password) {
  if (!isStrongPassword(password)) return "Password must be 12+ characters with uppercase, lowercase, a number and a symbol.";
  const db = readDb();
  const resets = activePasswordResets(db);
  const match = resets.find(item => passwordMatches(token, item.tokenHash));
  if (!match) return "This reset link is invalid or expired.";
  const account = db.accounts.find(item => item.id === match.accountId);
  if (!account) return "This reset link is invalid or expired.";
  account.passwordHash = hashPassword(password);
  db.passwordResets = resets.filter(item => item.tokenHash !== match.tokenHash);
  await writeDb(db);
  for (const [sessionToken, session] of sessions) if (session.id === account.id) sessions.delete(sessionToken);
  return null;
}

function authenticatedUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const user = sessions.get(token);
  if (!user || user.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return user;
}

function requestKey(req) {
  return req.socket.remoteAddress || "unknown";
}

function rateLimited(req) {
  const key = requestKey(req);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return attempts.length > 10;
}

module.exports = {isStrongPassword, hashPassword, passwordMatches, hasVerifiedUniversityEmail, hasUnverifiedContribution, emailTokenHash, loginUser, registerUser, provisionInitialAdmin, activePasswordResets, createPasswordReset, deletePasswordReset, createEmailVerification, emailBaseUrl, sendEmailVerification, verifyEmail, sendPasswordResetEmail, resetPassword, authenticatedUser, requestKey, rateLimited, sessions, emailReady};
