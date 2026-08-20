const bcrypt = require('bcryptjs');

// Mock passwordStore supaya test gak pernah baca/tulis file data/password-hashes.json beneran
jest.mock('../../utils/passwordStore', () => ({
  getHash: jest.fn(),
  setHash: jest.fn(),
  deleteHash: jest.fn()
}));

const passwordStore = require('../../utils/passwordStore');
const { hashPassword, verifyLogin, cacheNewPassword } = require('../../utils/password');

/**
 * verifyLogin() punya proses "fire-and-forget" (refresh cache password di
 * background, gak di-await). Nebak jumlah tick (setImmediate sekali) TERNYATA
 * gak reliable - waktu banyak test suite lain jalan BARENGAN (Jest jalanin
 * paralel di beberapa worker), CPU jadi rebutan dan proses bcrypt hash di
 * background butuh lebih dari 1 putaran event-loop buat kelar, bikin test
 * ini kadang gagal padahal kodenya benar (flaky).
 *
 * Solusinya: nunggu AKTIF (polling) sampai kondisinya beneran kejadian,
 * bukan nebak berapa lama harus nunggu.
 */
async function waitFor(conditionFn, { timeout = 3000, interval = 10 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor: kondisi gak kepenuhi dalam waktu yang ditentukan');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

describe('hashPassword', () => {
  test('menghasilkan bcrypt hash yang valid (bisa di-compare balik)', async () => {
    const hash = await hashPassword('rahasia123');
    expect(hash).not.toBe('rahasia123');
    const matches = await bcrypt.compare('rahasia123', hash);
    expect(matches).toBe(true);
  });
});

describe('verifyLogin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Kasih waktu proses background (kalau ada) buat kelar dulu sebelum
    // test berikutnya mulai, supaya mock call count gak nyampur antar test.
    // Dibungkus try/catch: kalau emang gak ada proses background yang perlu
    // ditunggu (test yang gak trigger fallback), ya biarin aja lewat.
    try {
      await waitFor(() => passwordStore.setHash.mock.calls.length > 0, { timeout: 200 });
    } catch {
      // gak masalah - berarti test ini emang gak trigger refresh cache
    }
  });

  test('cocok lewat local hash cache (fast path) -> true, gak perlu cek database', async () => {
    const localHash = await bcrypt.hash('mypassword', 10);
    passwordStore.getHash.mockReturnValue(localHash);

    const result = await verifyLogin('bobby', 'mypassword', 'IRRELEVANT_DB_VALUE');

    expect(result).toBe(true);
  });

  test('local hash ada tapi gak cocok, dan plain text DB juga gak cocok -> false', async () => {
    const localHash = await bcrypt.hash('passwordLama', 10);
    passwordStore.getHash.mockReturnValue(localHash);

    const result = await verifyLogin('bobby', 'passwordSalah', 'passwordDatabase');

    expect(result).toBe(false);
  });

  test('gak ada local hash sama sekali, tapi cocok sama plain text di database -> true (fallback)', async () => {
    passwordStore.getHash.mockReturnValue(null);

    const result = await verifyLogin('bobby', 'passwordBaru', 'passwordBaru');

    expect(result).toBe(true);
  });

  test('gak ada local hash, dan plain text DB juga gak cocok -> false', async () => {
    passwordStore.getHash.mockReturnValue(null);

    const result = await verifyLogin('bobby', 'salah', 'passwordAsli');

    expect(result).toBe(false);
  });

  test('local hash STALE (password di central system berubah) -> fallback ke DB, tetap true', async () => {
    const oldLocalHash = await bcrypt.hash('passwordLama', 10);
    passwordStore.getHash.mockReturnValue(oldLocalHash);

    const result = await verifyLogin('bobby', 'passwordBaru', 'passwordBaru');

    expect(result).toBe(true);
  });

  test('setelah fallback berhasil, cache lokal di-refresh (setHash dipanggil)', async () => {
    passwordStore.getHash.mockReturnValue(null);
    passwordStore.setHash.mockClear();

    await verifyLogin('bobby', 'passwordBaru', 'passwordBaru');

    await waitFor(() => passwordStore.setHash.mock.calls.length > 0);

    expect(passwordStore.setHash).toHaveBeenCalledWith('bobby', expect.any(String));
  });
});

describe('cacheNewPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('nge-hash password baru terus simpen ke passwordStore', async () => {
    await cacheNewPassword('bobby', 'passwordBaru123');

    expect(passwordStore.setHash).toHaveBeenCalledTimes(1);
    const [username, hash] = passwordStore.setHash.mock.calls[0];
    expect(username).toBe('bobby');
    const matches = await bcrypt.compare('passwordBaru123', hash);
    expect(matches).toBe(true);
  });
});