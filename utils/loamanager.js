const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'loa.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

function readData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('[LOA] Failed to read data file:', err);
    return [];
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Creates a new LOA request awaiting approval.
 * status starts as 'pending' — nothing is active and no role is
 * assigned until a manager clicks Approve.
 */
function createPendingLOA({ guildId, userId, reason, durationMs }) {
  const data = readData();
  const record = {
    id: crypto.randomUUID(),
    guildId,
    userId,
    reason,
    durationMs,
    requestedAt: Date.now(),
    startTimestamp: null,
    endTimestamp: null,
    actualEndTimestamp: null,
    status: 'pending', // pending | active | ended_early | expired | declined
    reviewedBy: null,
    reviewedAt: null,
    declineReason: null,
    endedBy: null,
    endReason: null,
    // reference to the review message so buttons/modal can edit it later
    messageId: null,
    channelId: null,
  };
  data.push(record);
  writeData(data);
  return record;
}

/** Attaches the review message's ID/channel to a record, for later edits. */
function setMessageRef(id, messageId, channelId) {
  const data = readData();
  const record = data.find(r => r.id === id);
  if (!record) return null;
  record.messageId = messageId;
  record.channelId = channelId;
  writeData(data);
  return record;
}

/** Approves a pending request, turning it into an active LOA. */
function approveLOA(id, { reviewedBy, startTimestamp, endTimestamp }) {
  const data = readData();
  const record = data.find(r => r.id === id);
  if (!record) return null;
  record.status = 'active';
  record.reviewedBy = reviewedBy;
  record.reviewedAt = Date.now();
  record.startTimestamp = startTimestamp;
  record.endTimestamp = endTimestamp;
  writeData(data);
  return record;
}

/** Declines a pending request. */
function declineLOA(id, { reviewedBy, declineReason }) {
  const data = readData();
  const record = data.find(r => r.id === id);
  if (!record) return null;
  record.status = 'declined';
  record.reviewedBy = reviewedBy;
  record.reviewedAt = Date.now();
  record.declineReason = declineReason;
  writeData(data);
  return record;
}

/** Ends an active LOA early or via expiry. */
function endLOA(id, { endedBy = null, endReason = null, status = 'ended_early' }) {
  const data = readData();
  const record = data.find(r => r.id === id);
  if (!record) return null;
  record.status = status;
  record.actualEndTimestamp = Date.now();
  record.endedBy = endedBy;
  record.endReason = endReason;
  writeData(data);
  return record;
}

function getRecordById(id) {
  const data = readData();
  return data.find(r => r.id === id) || null;
}

/** A user's currently pending OR active request/LOA, if any. */
function getActiveOrPendingLOA(guildId, userId) {
  const data = readData();
  return (
    data.find(
      r =>
        r.guildId === guildId &&
        r.userId === userId &&
        (r.status === 'pending' || r.status === 'active')
    ) || null
  );
}

function getActiveLOA(guildId, userId) {
  const data = readData();
  return (
    data.find(r => r.guildId === guildId && r.userId === userId && r.status === 'active') || null
  );
}

function getActiveLOAs(guildId) {
  const data = readData();
  return data
    .filter(r => r.guildId === guildId && r.status === 'active')
    .sort((a, b) => a.endTimestamp - b.endTimestamp);
}

function getUserHistory(guildId, userId) {
  const data = readData();
  return data
    .filter(r => r.guildId === guildId && r.userId === userId)
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

function getAllExpiredActive(now = Date.now()) {
  const data = readData();
  return data.filter(r => r.status === 'active' && r.endTimestamp <= now);
}

module.exports = {
  createPendingLOA,
  setMessageRef,
  approveLOA,
  declineLOA,
  endLOA,
  getRecordById,
  getActiveOrPendingLOA,
  getActiveLOA,
  getActiveLOAs,
  getUserHistory,
  getAllExpiredActive,
};