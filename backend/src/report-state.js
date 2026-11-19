const crypto = require("node:crypto");
const { privacyNoticeVersion } = require("./config");
const { validReport, reportFields, historyEntry, addNotification, trustLevel, matchReports, priorityScore } = require("./report-matching");

function publicDb(db, user) {
  const { role } = user;
  const { accounts, privateClues, passwordResets, ...safeDb } = db;
  void passwordResets;
  if (role === "admin") safeDb.privateClues = privateClues;
  safeDb.reports = safeDb.reports.map(report => report.type === "issue" ? { ...report, ...priorityScore(report) } : report);
  if (role === "admin") return safeDb;
  return {
    ...safeDb,
    reports: safeDb.reports.map(({ clue, claimDetail, claimStatus, attempts, votedBy, ...report }) => ({
      ...report,
      voted: (votedBy || []).includes(user.id)
    })),
    claims: ["user", "staff"].includes(role)
      ? safeDb.claims.filter(claim => claim.claimantId === user.id).map(({ detail, ...claim }) => claim)
      : [],
    notifications: safeDb.notifications.filter(notification => notification.userId === user.id),
    tasks: role === "staff" ? safeDb.tasks.filter(task => task.assigneeEmail === user.email) : []
  };
}

function cleanReport(report, user) {
  const now = new Date().toISOString();
  const created = {
    ...reportFields(report),
    id: report.id ?? crypto.randomUUID(),
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    statusChangedAt: now,
    status: report.type === "found" ? "Found" : "Open",
    priority: "Medium",
    severity: report.type === "issue" ? (["Low", "Medium", "High"].includes(report.severity) ? report.severity : "Medium") : undefined,
    safetyRisk: report.type === "issue" && report.safetyRisk === true,
    votes: 0,
    votedBy: [],
    history: [historyEntry(user, "Report created")],
    campusId: "uftb-main"
  };
  if (report.consent === true) {
    created.consentAt = now;
    created.consentVersion = privacyNoticeVersion;
  }
  delete created.clue;
  delete created.claimDetail;
  delete created.claimStatus;
  delete created.attempts;
  created.possibleDuplicate = false;
  return created;
}

function mergeState(current, incoming, user) {
  const { role } = user;
  if (!incoming || !Array.isArray(incoming.reports) || !Array.isArray(incoming.notifications) || !Array.isArray(incoming.tasks)) {
    throw new Error("Invalid state shape");
  }
  if (incoming.reports.some(report => !validReport(report)) ||
    new Set(incoming.reports.map(report => String(report.id))).size !== incoming.reports.length) throw new Error("Invalid or duplicate report data");
  const db = { ...current, claims: current.claims || [], reports: [...current.reports], tasks: [...current.tasks], notifications: [...current.notifications] };
  const existingReports = new Map(db.reports.map(report => [String(report.id), report]));
  const submittedReports = new Map(incoming.reports.map(report => [String(report.id), report]));
  if (role === "staff") {
    const updates = new Map(incoming.tasks.map(task => [task.id, task.status]));
    db.tasks = db.tasks.map(task => {
      if (task.assigneeEmail !== user.email || !updates.has(task.id)) return task;
      const nextStatus = updates.get(task.id);
      if (!((task.status === "Assigned" && nextStatus === "In progress") ||
        (task.status === "In progress" && nextStatus === "Completed"))) return task;
      const report = existingReports.get(String(task.reportId));
      if (report) {
        report.history = [...(report.history || []), historyEntry(user, `Task ${nextStatus.toLowerCase()}`)];
        report.updatedAt = new Date().toISOString();
      }
      if (nextStatus === "Completed") {
        task.completedAt = new Date().toISOString();
        if (report) addNotification(db, report.createdBy, `Assigned work for "${report.title}" was completed and awaits administrator review.`, report.id);
      }
      return { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
    });
  }
  if (role === "user" || role === "staff") {
    for (const old of db.reports) {
      const update = submittedReports.get(String(old.id));
      if (!update || old.createdBy !== user.id || !["Open", "Found"].includes(old.status)) continue;
      const changedFields = [];
      for (const key of ["title", "category", "place", "date", "color", "text", "photos", "latitude", "longitude"]) {
        if (update[key] !== undefined && JSON.stringify(old[key]) !== JSON.stringify(update[key])) {
          old[key] = update[key];
          changedFields.push(key);
        }
      }
      if (changedFields.length) {
        old.history = [...(old.history || []), historyEntry(user, `Report details updated (${changedFields.join(", ")})`)];
        old.updatedAt = new Date().toISOString();
      }
    }
    for (const old of db.reports) {
      const update = submittedReports.get(String(old.id));
      if (!update) continue;
      const votedBy = old.votedBy || [];
      if (old.type === "issue" && old.status === "Open" && update.voted && !votedBy.includes(user.id)) {
        old.votedBy = [...votedBy, user.id];
        old.votes = old.votedBy.length;
        old.history = [...(old.history || []), historyEntry(user, "Upvote added")];
        old.updatedAt = new Date().toISOString();
      }
    }
    for (const report of incoming.reports) {
      if (existingReports.has(String(report.id))) continue;
      if (report.consent !== true) throw new Error("Consent is required before submitting a report.");
      const created = cleanReport(report, user);
      if (created.type === "issue") {
        const duplicate = db.reports.find(old => {
          const age = Date.now() - new Date(old.createdAt || old.date).getTime();
          return old.type === "issue" && old.status === "Open" &&
            old.category.toLowerCase() === created.category.toLowerCase() &&
            old.place.trim().toLowerCase() === created.place.trim().toLowerCase() &&
            age >= 0 && age <= 14 * 86400000;
        });
        if (duplicate) created.possibleDuplicate = true;
      }
      db.reports.unshift(created);
      addNotification(db, db.accounts.find(account => account.role === "admin")?.id, `New ${created.type === "issue" ? "campus issue" : "item"} report: "${created.title}".`, created.id);
      for (const lost of db.reports.filter(item => item.type === "lost")) {
        if (created.type === "found" && matchReports(lost, created).score >= 50) {
          addNotification(db, lost.createdBy, `A possible match was found for "${lost.title}".`, lost.id);
        } else if (created.type === "lost" && lost.id === created.id) {
          const match = db.reports.find(item => item.type === "found" && matchReports(lost, item).score >= 50);
          if (match) addNotification(db, created.createdBy, `A possible match is available for "${created.title}".`, created.id);
        }
      }
    }
    const readIds = new Set(incoming.notifications.filter(item => item.read).map(item => item.id));
    db.notifications = db.notifications.map(item => item.userId === user.id && readIds.has(item.id) ? { ...item, read: true } : item);
    return db;
  }
  if (role === "admin") {
    const clueReports = new Set(db.reports.filter(report => report.type === "found").map(report => String(report.id)));
    db.privateClues = (incoming.privateClues || []).filter(clue => clueReports.has(String(clue.reportId)) && typeof clue.clue === "string" && clue.clue.length <= 300)
      .map(clue => ({ reportId: clue.reportId, clue: clue.clue, recordedBy: user.id, recordedAt: new Date().toISOString(), campusId: "uftb-main" }));
    for (const report of db.reports) {
      const update = submittedReports.get(String(report.id));
      if (!update) continue;
      const previousStatus = report.status;
      const previousPriority = report.priority;
      if (update.type !== undefined && update.type !== report.type) {
        throw new Error("A report type cannot be changed after submission.");
      }
      const allowedTransitions = {
        lost: { Open: ["Resolved", "Merged"] },
        found: { Found: ["Resolved", "Returned"] },
        issue: { Open: ["Resolved", "Merged"] }
      };
      if (update.status !== undefined && update.status !== previousStatus &&
        !allowedTransitions[report.type]?.[previousStatus]?.includes(update.status)) {
        throw new Error("This report status transition is not allowed.");
      }
      if (report.type !== "issue" && (update.severity != null || update.safetyRisk === true)) {
        throw new Error("Severity and safety risk apply only to campus issues.");
      }
      if (update.severity !== undefined && !["Low", "Medium", "High"].includes(update.severity)) {
        throw new Error("Choose a valid issue severity.");
      }
      if (update.safetyRisk !== undefined && typeof update.safetyRisk !== "boolean") {
        throw new Error("Safety risk must be true or false.");
      }
      const confirmingHandover = previousStatus !== "Returned" && update.status === "Returned";
      if (confirmingHandover) {
        if (report.type !== "found" || previousStatus !== "Found") {
          throw new Error("Only found items can be returned from the Found status.");
        }
        if (!db.claims.some(claim => String(claim.reportId) === String(report.id) && claim.status === "Approved")) {
          throw new Error("An approved claim is required before returning this item.");
        }
        if (update.identityChecked !== true) {
          throw new Error("Confirm the in-person identity check before returning this item.");
        }
      }
      if (update.priority !== undefined && !["Low", "Medium", "High"].includes(update.priority)) throw new Error("Choose a valid priority.");
      if (update.priority !== undefined && update.priority !== previousPriority &&
        (!["Low", "Medium", "High"].includes(update.priority) || (update.overrideReason || "").trim().length < 3)) {
        throw new Error("A short reason is required to override priority.");
      }
      for (const [key, value] of Object.entries(reportFields(update))) {
        if (["id", "createdBy", "votes", "votedBy", "history", "createdAt"].includes(key)) continue;
        report[key] = value;
      }
      report.votes = (report.votedBy || []).length;
      if (report.status !== previousStatus) {
        const statusChange = confirmingHandover
          ? "Item returned after in-person identity check"
          : `Status changed to ${report.status}`;
        report.history = [...(report.history || []), historyEntry(user, statusChange)];
        report.statusChangedAt = new Date().toISOString();
        addNotification(db, report.createdBy, `The status of "${report.title}" is now ${report.status}.`, report.id);
      }
      if (report.priority !== previousPriority) {
        report.history = [...(report.history || []), historyEntry(user, `Priority changed to ${report.priority}${report.overrideReason ? `: ${report.overrideReason}` : ""}`)];
      }
      report.updatedAt = new Date().toISOString();
    }
    const submittedClaims = new Map((incoming.claims || []).map(claim => [claim.id, claim]));
    const approvedReports = new Set(db.claims
      .filter(claim => claim.status === "Approved")
      .map(claim => String(claim.reportId)));
    db.claims = db.claims.map(claim => {
      const update = submittedClaims.get(claim.id);
      if (!update) return claim;
      if (update.status === claim.status) return claim;
      if (!["Approved", "Rejected", "Needs more information"].includes(update.status) || claim.status !== "Pending review") {
        throw new Error("Only pending claims can be reviewed.");
      }
      const report = existingReports.get(String(claim.reportId));
      if (update.status === "Approved") {
        if (!report || report.type !== "found" || report.status !== "Found") {
          throw new Error("Claims can only be approved while the found item is available.");
        }
        if (approvedReports.has(String(claim.reportId))) {
          throw new Error("A claim has already been approved for this item.");
        }
        approvedReports.add(String(claim.reportId));
      }
      if (report) report.history = [...(report.history || []), historyEntry(user, `Claim ${update.status.toLowerCase()}`)];
      addNotification(db, claim.claimantId, `Your claim for "${report?.title || "a found item"}" is ${update.status.toLowerCase()}.`, claim.reportId);
      return { ...claim, status: update.status, reviewedBy: user.id, reviewedAt: new Date().toISOString() };
    });
    const submittedTasks = new Map(incoming.tasks.map(task => [String(task.id), task]));
    db.tasks = db.tasks.map(task => {
      const update = submittedTasks.get(String(task.id));
      if (!update) return task;
      if (update.assigneeEmail !== task.assigneeEmail &&
        !db.accounts.some(account => account.email === update.assigneeEmail && account.role === "staff" && account.status === "active")) {
        throw new Error("Tasks can only be assigned to an active Staff account.");
      }
      return { ...task, text: update.text || task.text, assignee: update.assignee || task.assignee, assigneeEmail: update.assigneeEmail || task.assigneeEmail };
    });
    for (const task of incoming.tasks) {
      if (db.tasks.some(currentTask => String(currentTask.id) === String(task.id))) continue;
      if (!existingReports.has(String(task.reportId)) || !db.accounts.some(account => account.email === task.assigneeEmail && account.role === "staff" && account.status === "active")) continue;
      db.tasks.push({
        id: task.id,
        reportId: task.reportId,
        assignee: task.assignee,
        assigneeEmail: task.assigneeEmail,
        text: String(task.text || "").slice(0, 300),
        status: "Assigned",
        campusId: "uftb-main",
        assignedAt: new Date().toISOString()
      });
      const report = existingReports.get(String(task.reportId));
      report.history = [...(report.history || []), historyEntry(user, `Task assigned to ${task.assignee}`)];
      report.updatedAt = new Date().toISOString();
      addNotification(db, db.accounts.find(account => account.email === task.assigneeEmail)?.id, `A maintenance task was assigned: ${task.text}.`, task.reportId);
    }
    const readIds = new Set(incoming.notifications.filter(item => item.read).map(item => item.id));
    db.notifications = db.notifications.map(item => item.userId === user.id && readIds.has(item.id) ? { ...item, read: true } : item);
    return db;
  }
  throw new Error("Role is not allowed to update application state");
}

module.exports = {publicDb, cleanReport, mergeState};
