const crypto = require("node:crypto");
const { privacyNoticeVersion } = require("./config");
const { readDb, writeDb } = require("./database");
const { validUniversityEmail } = require("./report-matching");
const sessions = new Map();
const loginAttempts = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;

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

function loginUser(email, password) {
  const db = readDb();
  const account = db.accounts.find(item => item.email === email.toLowerCase());
  if (account && account.status === "pending") return { error: `This ${account.requestedRole === "staff" ? "Staff" : "Administrator"} account is waiting for approval.` };
  if (!isStrongPassword(password) || !account || !passwordMatches(password, account.passwordHash)) return null;
  const token = crypto.randomUUID();
  sessions.set(token, { id: account.id, email: email.toLowerCase(), role: account.role, name: account.name, expiresAt: Date.now() + sessionLifetime });
  return { token, id: account.id, email: email.toLowerCase(), role: account.role, name: account.name };
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
    passwordHash: hashPassword(password), privacyConsentAt: new Date().toISOString(),
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
    passwordHash: hashPassword(password), campusId: "uftb-main", createdAt: now
  });
  await writeDb(db);
  console.log(`Initial administrator provisioned for ${email}. Remove the bootstrap credentials from the environment.`);
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

module.exports = {isStrongPassword, hashPassword, passwordMatches, loginUser, registerUser, provisionInitialAdmin, authenticatedUser, requestKey, rateLimited, sessions};
