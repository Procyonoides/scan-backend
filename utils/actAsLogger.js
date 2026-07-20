const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const RETENTION_DAYS = 90; // old log files older than this get auto-deleted

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function todayFileName(date = new Date()) {
  return `act-as-${date.toISOString().slice(0, 10)}.log`;
}

function getLogFilePath(date = new Date()) {
  return path.join(LOG_DIR, todayFileName(date));
}

/**
 * Append one entry to today's log file.
 * entry: plain object, gets a timestamp attached automatically.
 */
function writeLog(entry) {
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFile(getLogFilePath(), line, (err) => {
    if (err) console.error('❌ Failed to write act-as audit log:', err.message);
  });
}

/**
 * Express middleware: if the current request is authenticated via an
 * "act-as" token, automatically log every state-changing request
 * (POST/PUT/DELETE/PATCH) it makes - no need to touch individual routes.
 */
function auditActAs(req, res, next) {
  const stateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  if (req.user?.actingAs && stateChanging) {
    writeLog({
      event: 'ACTION',
      realUser: req.user.realUsername,
      realPosition: req.user.realPosition,
      actingAsUser: req.user.username,
      actingAsPosition: req.user.position,
      method: req.method,
      path: req.originalUrl
    });
  }
  next();
}

/**
 * Read log entries across all daily files, most recent first.
 * Optional { from, to } filter as 'YYYY-MM-DD' strings.
 */
function readLogs({ from, to } = {}) {
  if (!fs.existsSync(LOG_DIR)) return [];

  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('act-as-') && f.endsWith('.log'));

  let entries = [];
  for (const file of files) {
    const dateStr = file.replace('act-as-', '').replace('.log', '');
    if (from && dateStr < from) continue;
    if (to && dateStr > to) continue;

    const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch (e) { /* skip malformed line */ }
    }
  }

  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Delete log files older than RETENTION_DAYS. Safe to call on server startup;
 * keeps the logs folder from growing forever.
 */
function pruneOldLogs() {
  if (!fs.existsSync(LOG_DIR)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('act-as-') && f.endsWith('.log'));

  for (const file of files) {
    const dateStr = file.replace('act-as-', '').replace('.log', '');
    if (dateStr < cutoffStr) {
      fs.unlink(path.join(LOG_DIR, file), (err) => {
        if (err) console.error(`❌ Failed to prune old log ${file}:`, err.message);
        else console.log(`🗑️ Pruned old act-as log: ${file}`);
      });
    }
  }
}

module.exports = { writeLog, auditActAs, readLogs, pruneOldLogs, LOG_DIR };
