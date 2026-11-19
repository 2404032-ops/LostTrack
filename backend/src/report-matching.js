const crypto = require("node:crypto");
const { isBangladeshPoint } = require("./bangladesh-boundary");

function validUniversityEmail(email) {
  return typeof email === "string" && /^[a-z0-9._%+-]+@uftb\.ac\.bd$/i.test(email);
}

function validCoordinates(latitude, longitude) {
  return isBangladeshPoint(latitude, longitude);
}

function validDate(value) {
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validReport(report) {
  const hasLatitude = report?.latitude !== undefined;
  const hasLongitude = report?.longitude !== undefined;
  return report && (typeof report.id === "string" || Number.isSafeInteger(report.id)) &&
    String(report.id).length <= 80 && ["lost", "found", "issue"].includes(report.type) &&
    typeof report.title === "string" && report.title.trim().length > 0 &&
    typeof report.category === "string" && report.category.length <= 80 &&
    typeof report.place === "string" && report.place.trim().length > 0 && report.place.length <= 160 &&
    typeof report.text === "string" && report.title.length <= 120 && report.text.length <= 2000 &&
    ((!hasLatitude && !hasLongitude) || (hasLatitude && hasLongitude &&
      validCoordinates(report.latitude, report.longitude))) &&
    validDate(report.date) &&
    (!report.color || (typeof report.color === "string" && report.color.length <= 40)) &&
    (!report.photos || (Array.isArray(report.photos) && report.photos.length <= 3 && report.photos.every(photo => typeof photo === "string" && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(photo))));
}

function reportFields(report) {
  const fields = ["type", "title", "category", "place", "date", "color", "text", "photos", "latitude", "longitude", "severity", "safetyRisk", "possibleDuplicate", "duplicateOf", "status", "priority", "overrideReason"];
  return Object.fromEntries(fields.filter(key => report[key] !== undefined).map(key => [key, report[key]]));
}

function historyEntry(user, text) {
  return `${text} by ${user.name} - ${new Date().toISOString()}`;
}

function locationPoints(lost, found) {
  const normalize = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (normalize(lost.place) === normalize(found.place)) return 20;
  return (lost.campusId || "uftb-main") === (found.campusId || "uftb-main") ? 10 : 0;
}

function addNotification(db, userId, text, refId) {
  if (!userId) return;
  db.notifications.push({ id: crypto.randomUUID(), userId, text, refId, read: false, campusId: "uftb-main", createdAt: new Date().toISOString() });
}

function trustLevel(db, accountId) {
  const account = db.accounts.find(item => item.id === accountId);
  const ageDays = account ? (Date.now() - new Date(account.createdAt).getTime()) / 86400000 : 0;
  const earlier = db.claims.filter(claim => claim.claimantId === accountId);
  const rejected = earlier.filter(claim => claim.status === "Rejected").length;
  const approved = earlier.some(claim => claim.status === "Approved");
  if (ageDays < 7 || rejected >= 3) return "Basic";
  if (approved && rejected === 0) return "Trusted";
  return "Verified";
}

function matchReports(lost, found) {
  if (lost.type !== "lost" || found.type !== "found" ||
    String(lost.category).toLowerCase() !== String(found.category).toLowerCase()) {
    return {
      score: 0,
      reasons: [],
      factors: [
        { name: "Category", points: 0, max: 30 },
        { name: "Colour", points: 0, max: 20 },
        { name: "Location", points: 0, max: 20 },
        { name: "Date", points: 0, max: 15 },
        { name: "Keywords", points: 0, max: 15 }
      ]
    };
  }
  let score = 30;
  const reasons = ["same category"];
  const factors = [{ name: "Category", points: 30, max: 30 }];
  const colors = [lost.color, found.color].map(value => String(value || "").trim().toLowerCase());
  const colorFamily = value => {
    if (["black", "navy", "dark blue", "charcoal"].includes(value)) return "dark";
    if (["blue", "light blue", "sky blue"].includes(value)) return "blue";
    if (["red", "maroon", "pink"].includes(value)) return "red";
    if (["white", "silver", "gray", "grey"].includes(value)) return "light";
    return value;
  };
  const colorPoints = colors[0] && colors[0] === colors[1] ? 20
    : colors[0] && colors[1] && colorFamily(colors[0]) === colorFamily(colors[1]) ? 10 : 0;
  score += colorPoints;
  factors.push({ name: "Colour", points: colorPoints, max: 20 });
  if (colorPoints) reasons.push(colorPoints === 20 ? "colour" : "similar colour");
  const placePoints = locationPoints(lost, found);
  score += placePoints;
  factors.push({ name: "Location", points: placePoints, max: 20 });
  if (placePoints === 20) reasons.push("same location");
  else if (placePoints === 10) reasons.push("nearby campus area");
  const lostDate = Date.parse(lost.date), foundDate = Date.parse(found.date);
  const elapsedDays = (foundDate - lostDate) / 86400000;
  const datePoints = Number.isFinite(elapsedDays) && elapsedDays >= 0 && elapsedDays <= 3 ? 15
    : Number.isFinite(elapsedDays) && elapsedDays > 3 && elapsedDays <= 7 ? 8 : 0;
  score += datePoints;
  factors.push({ name: "Date", points: datePoints, max: 15 });
  if (datePoints) reasons.push(datePoints === 15 ? "date within 3 days" : "date within 7 days");
  const stopWords = new Set([
    "the", "and", "for", "with", "near", "from", "this", "that", "item", "lost", "found",
    "এবং", "কিংবা", "একটি", "আমার", "হারানো", "পাওয়া", "পাওয়া", "জিনিস", "সামনে", "কাছে"
  ]);
  const words = value => new Set(String(value || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)?.filter(word => word.length > 1 && !stopWords.has(word)) || []);
  const left = words(lost.text), right = words(found.text);
  const union = new Set([...left, ...right]);
  const shared = [...left].filter(word => right.has(word)).length;
  if (union.size) {
    const points = Math.round(15 * shared / union.size);
    score += points;
    factors.push({ name: "Keywords", points, max: 15 });
    if (points) reasons.push(`keywords ${shared}/${union.size}`);
  } else {
    factors.push({ name: "Keywords", points: 0, max: 15 });
  }
  return { score, reasons, factors };
}

function priorityScore(report) {
  const severity = { Low: 0.33, Medium: 0.67, High: 1 }[report.severity] || 0.67;
  const votes = Math.min((report.votes || 0) / 20, 1);
  const risk = report.safetyRisk ? 1 : 0;
  const opened = Date.parse(report.status === "Open" ? report.statusChangedAt || report.createdAt || report.date : report.createdAt || report.date);
  const ageDays = Number.isFinite(opened) ? Math.max(0, (Date.now() - opened) / 86400000) : 0;
  const age = Math.min(ageDays / 14, 1);
  const score = Math.round(100 * (0.4 * severity + 0.3 * votes + 0.2 * risk + 0.1 * age));
  const suggestedPriority = report.safetyRisk && report.severity === "High" ? "High" : score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return { score, suggestedPriority, overdue: report.type === "issue" && report.status === "Open" && report.priority === "High" && ageDays > 7 };
}

module.exports = {validUniversityEmail, validCoordinates, validDate, validReport, reportFields, historyEntry, locationPoints, addNotification, trustLevel, matchReports, priorityScore};
