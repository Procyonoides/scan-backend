const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'password-hashes.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, '{}');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ Failed to read password-hashes.json, starting fresh:', e.message);
    return {};
  }
}

function writeStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('❌ Failed to write password-hashes.json:', e.message);
  }
}

/** Get the locally-cached bcrypt hash for a username, or null if none. */
function getHash(username) {
  return readStore()[username] || null;
}

/** Store/overwrite the locally-cached hash for a username. */
function setHash(username, hash) {
  const store = readStore();
  store[username] = hash;
  writeStore(store);
}

/** Remove a username's cached hash (e.g. if it needs to be recomputed). */
function deleteHash(username) {
  const store = readStore();
  delete store[username];
  writeStore(store);
}

module.exports = { getHash, setHash, deleteHash, STORE_FILE };