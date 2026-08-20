process.env.JWT_SECRET = 'test-secret-key';

jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(), // req.user di-set manual per-app di bawah
  verifyRole: () => (req, res, next) => next()
}));
jest.mock('../../utils/password', () => ({
  verifyLogin: jest.fn()
}));
jest.mock('../../utils/actAsLogger', () => ({
  writeLog: jest.fn(),
  readLogs: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { query } = require('../../config/database');
const { verifyLogin } = require('../../utils/password');
const { writeLog, readLogs } = require('../../utils/actAsLogger');
const authRouter = require('../../routes/auth.routes');

/** App tanpa req.user (buat /login, /refresh, /verify - route publik) */
function buildPublicApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

/** App dengan req.user custom (buat /act-as, /exit-act-as, /act-as-logs) */
function buildAppAsUser(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/auth', authRouter);
  return app;
}

const fakeUserRow = {
  id_user: 1,
  username: 'bobby',
  password: 'PLAIN_TEXT_DARI_DB',
  position: 'IT',
  description: 'IT Staff'
};

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    query.mockReset();
    verifyLogin.mockReset();
  });

  test('400 kalau username atau password kosong', async () => {
    const res = await request(buildPublicApp())
      .post('/api/auth/login')
      .send({ username: '', password: '' });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('401 kalau username gak ketemu di database', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildPublicApp())
      .post('/api/auth/login')
      .send({ username: 'gakada', password: 'apapun' });

    expect(res.status).toBe(401);
    expect(verifyLogin).not.toHaveBeenCalled();
  });

  test('401 kalau password salah', async () => {
    query.mockResolvedValueOnce({ recordset: [fakeUserRow] });
    verifyLogin.mockResolvedValueOnce(false);

    const res = await request(buildPublicApp())
      .post('/api/auth/login')
      .send({ username: 'bobby', password: 'salah' });

    expect(res.status).toBe(401);
  });

  test('200 sukses: dapet token JWT valid + permission sesuai posisi', async () => {
    query.mockResolvedValueOnce({ recordset: [fakeUserRow] });
    verifyLogin.mockResolvedValueOnce(true);

    const res = await request(buildPublicApp())
      .post('/api/auth/login')
      .send({ username: 'bobby', password: 'benar' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.position).toBe('IT');
    expect(res.body.user.permissions).toContain('manage_users');

    const decoded = jwt.verify(res.body.token, 'test-secret-key');
    expect(decoded.username).toBe('bobby');
    expect(decoded.position).toBe('IT');
  });

  test('permissions kosong kalau posisi user gak dikenal di rolePermissions', async () => {
    query.mockResolvedValueOnce({ recordset: [{ ...fakeUserRow, position: 'ENTAH_APA' }] });
    verifyLogin.mockResolvedValueOnce(true);

    const res = await request(buildPublicApp())
      .post('/api/auth/login')
      .send({ username: 'bobby', password: 'benar' });

    expect(res.body.user.permissions).toEqual([]);
  });
});

describe('POST /api/auth/act-as/:userId', () => {
  const itUser = { id_user: 1, username: 'itstaff', position: 'IT' };

  beforeEach(() => {
    query.mockReset();
    writeLog.mockReset();
  });

  test('404 kalau user target gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .post('/api/auth/act-as/999');

    expect(res.status).toBe(404);
  });

  test('403 kalau target-nya sesama IT (gak boleh act-as ke akun IT lain)', async () => {
    query.mockResolvedValueOnce({ recordset: [{ id_user: 2, username: 'it2', position: 'IT' }] });

    const res = await request(buildAppAsUser(itUser))
      .post('/api/auth/act-as/2');

    expect(res.status).toBe(403);
    expect(writeLog).not.toHaveBeenCalled();
  });

  test('200 sukses: token actingAs berisi identitas asli DAN identitas yang di-"pakai", plus ke-log', async () => {
    query.mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1', position: 'RECEIVING', description: '' }] });

    const res = await request(buildAppAsUser(itUser))
      .post('/api/auth/act-as/5');

    expect(res.status).toBe(200);
    expect(res.body.user.actingAs).toBe(true);
    expect(res.body.user.username).toBe('gudang1');

    const decoded = jwt.verify(res.body.token, 'test-secret-key');
    expect(decoded.actingAs).toBe(true);
    expect(decoded.realUsername).toBe('itstaff');
    expect(decoded.username).toBe('gudang1');

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'SESSION_START',
      realUser: 'itstaff',
      actingAsUser: 'gudang1'
    }));
  });
});

describe('POST /api/auth/exit-act-as', () => {
  beforeEach(() => writeLog.mockReset());

  test('nge-log SESSION_END kalau ini beneran act-as session', async () => {
    const actingUser = { actingAs: true, realUsername: 'itstaff', realPosition: 'IT', username: 'gudang1', position: 'RECEIVING' };

    await request(buildAppAsUser(actingUser)).post('/api/auth/exit-act-as');

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'SESSION_END' }));
  });

  test('GAK nge-log kalau ini login normal (bukan act-as)', async () => {
    const normalUser = { actingAs: false, username: 'bobby', position: 'IT' };

    await request(buildAppAsUser(normalUser)).post('/api/auth/exit-act-as');

    expect(writeLog).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/act-as-logs', () => {
  test('nerusin filter from/to ke readLogs()', async () => {
    readLogs.mockReturnValueOnce([{ event: 'SESSION_START' }]);
    const itUser = { id_user: 1, username: 'itstaff', position: 'IT' };

    const res = await request(buildAppAsUser(itUser))
      .get('/api/auth/act-as-logs?from=2026-01-01&to=2026-01-31');

    expect(res.status).toBe(200);
    expect(readLogs).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' });
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/auth/refresh', () => {
  test('401 kalau gak ada token', async () => {
    const res = await request(buildPublicApp()).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  test('sukses: bisa refresh walau token LAMA udah expired (ignoreExpiration)', async () => {
    const expiredToken = jwt.sign(
      { id_user: 1, username: 'bobby', position: 'IT' },
      'test-secret-key',
      { expiresIn: '-1h' }
    );

    const res = await request(buildPublicApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const decoded = jwt.verify(res.body.token, 'test-secret-key');
    expect(decoded.username).toBe('bobby');
  });

  test('401 kalau token rusak/gak valid', async () => {
    const res = await request(buildPublicApp())
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer token-ngasal-rusak');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/verify', () => {
  test('valid:true kalau token masih berlaku', async () => {
    const token = jwt.sign({ username: 'bobby' }, 'test-secret-key', { expiresIn: '1h' });

    const res = await request(buildPublicApp())
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test('valid:false kalau token udah expired', async () => {
    const expiredToken = jwt.sign({ username: 'bobby' }, 'test-secret-key', { expiresIn: '-1h' });

    const res = await request(buildPublicApp())
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.valid).toBe(false);
  });

  test('valid:false kalau gak ada token', async () => {
    const res = await request(buildPublicApp()).get('/api/auth/verify');
    expect(res.status).toBe(401);
  });
});