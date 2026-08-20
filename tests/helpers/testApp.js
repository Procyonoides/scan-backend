const express = require('express');

/**
 * Bikin Express app minimal buat nge-test 1 router, tanpa perlu server
 * beneran / JWT token asli.
 *
 * Login dipalsuin lewat header kustom:
 *   x-test-username, x-test-position
 * (default: username 'tester', position 'IT' - biar lolos verifyRole apa pun
 * kecuali kalau test butuh position spesifik)
 */
function createTestApp(router, mountPath) {
  const app = express();
  app.use(express.json());

  // Ganti auth beneran dengan user palsu dari header, supaya tiap test
  // bisa gonta-ganti role/username tanpa perlu bikin JWT token asli
  app.use((req, res, next) => {
    req.user = {
      username: req.headers['x-test-username'] || 'tester',
      position: req.headers['x-test-position'] || 'IT'
    };
    next();
  });

  app.use(mountPath, router);
  return app;
}

module.exports = { createTestApp };