const bcrypt = require('bcryptjs');
const passwordStore = require('./passwordStore');

/**
 * Hash a plain-text password. Used only for the local hash cache
 * (passwordStore) - NEVER written into the SQL Server database, since
 * that database is shared with the central/pusat system and must stay
 * untouched (still plain text) so other applications reading it aren't
 * affected by this app's own security choices.
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

/**
 * Verify a login attempt.
 *
 * Fast path: compare against the locally-cached bcrypt hash (passwordStore),
 * which lives in a local JSON file, not the database.
 *
 * Fallback: if there's no local hash yet, or the local hash no longer
 * matches (e.g. the central system changed the password after a DB
 * refresh), fall back to comparing against the database's plain-text
 * password directly. On a successful fallback match, the local hash
 * cache is refreshed so next login uses the fast path again.
 *
 * dbPlainPassword: the value currently in dbo.users.password (always
 * plain text, never modified by this app).
 */
async function verifyLogin(username, plainPassword, dbPlainPassword) {
  const localHash = passwordStore.getHash(username);

  if (localHash) {
    const matches = await bcrypt.compare(plainPassword, localHash);
    if (matches) return true;
    // Local hash is stale (password most likely changed at the source) -
    // fall through to check the database's plain-text value directly.
  }

  if (plainPassword === dbPlainPassword) {
    // Refresh the local cache for next time - fire and forget.
    hashPassword(plainPassword)
      .then(hash => passwordStore.setHash(username, hash))
      .catch(err => console.error(`❌ Failed to cache password hash for ${username}:`, err.message));
    return true;
  }

  return false;
}

/**
 * After IT resets/sets a user's password (which is written to the
 * database as plain text, as always), pre-populate the local hash cache
 * so the very next login can use the fast hashed path immediately.
 */
async function cacheNewPassword(username, plainPassword) {
  const hash = await hashPassword(plainPassword);
  passwordStore.setHash(username, hash);
}

module.exports = { hashPassword, verifyLogin, cacheNewPassword };