const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const envFile = path.join(projectRoot, ".env");
if (!process.env.LOSTTRACK_DATA_FILE && fs.existsSync(envFile)) {
  for (const [index, rawLine] of fs.readFileSync(envFile, "utf8").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`Invalid .env entry on line ${index + 1}.`);
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

const port = Number(process.env.PORT) || 3000;
const frontendRoot = path.join(projectRoot, "frontend", "pages");
const assetsRoot = path.join(projectRoot, "frontend", "assets");
const dataFile = process.env.LOSTTRACK_DATA_FILE || path.join(projectRoot, "backend", "storage", "db.json");
const dataDir = path.dirname(dataFile);
const uploadDir = path.join(dataDir, "uploads");
const retentionSetting = process.env.LOSTTRACK_REPORT_RETENTION_DAYS;
const privacyNoticeVersion = "1.0";
const reportRetentionDays = retentionSetting === undefined ? 30 : Number(retentionSetting);
if (!Number.isSafeInteger(reportRetentionDays) || reportRetentionDays < 1 || reportRetentionDays > 3650) {
  throw new Error("LOSTTRACK_REPORT_RETENTION_DAYS must be a whole number from 1 to 3650.");
}

module.exports = {
  projectRoot, port, frontendRoot, assetsRoot,
  dataFile, dataDir, uploadDir, reportRetentionDays, privacyNoticeVersion
};
