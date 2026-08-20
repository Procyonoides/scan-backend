jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));
jest.mock('../../utils/password', () => ({
  verifyLogin: jest.fn(),
  cacheNewPassword: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const { query } = require('../../config/database');
const { verifyLogin, cacheNewPassword } = require('../../utils/password');
const userRouter = require('../../routes/user.routes');

function buildAppAsUser(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/users', userRouter);
  return app;
}

const itUser = { id_user: 1, username: 'itstaff', position: 'IT' };

describe('POST /api/users (create)', () => {
  beforeEach(() => {
    query.mockReset();
    cacheNewPassword.mockReset();
  });

  test('400 kalau ada field wajib yang kosong', async () => {
    const res = await request(buildAppAsUser(itUser))
      .post('/api/users')
      .send({ username: 'baru' });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('400 kalau position bukan salah satu dari yang valid', async () => {
    const res = await request(buildAppAsUser(itUser))
      .post('/api/users')
      .send({ username: 'baru', password: 'rahasia', position: 'SUPERADMIN' });

    expect(res.status).toBe(400);
  });

  test('400 kalau username udah ada yang pakai', async () => {
    query.mockResolvedValueOnce({ recordset: [{ id_user: 9 }] });

    const res = await request(buildAppAsUser(itUser))
      .post('/api/users')
      .send({ username: 'sudahada', password: 'rahasia', position: 'RECEIVING' });

    expect(res.status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('201 sukses: user ke-insert DAN cache password lokal ke-refresh', async () => {
    query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .post('/api/users')
      .send({ username: 'gudangbaru', password: 'rahasia123', position: 'RECEIVING' });

    expect(res.status).toBe(201);
    expect(cacheNewPassword).toHaveBeenCalledWith('gudangbaru', 'rahasia123');
  });
});

describe('PUT /api/users/:id (update)', () => {
  beforeEach(() => {
    query.mockReset();
    cacheNewPassword.mockReset();
  });

  test('404 kalau user gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/999')
      .send({ description: 'test' });

    expect(res.status).toBe(404);
  });

  test('400 kalau gak ada field yang diubah sama sekali', async () => {
    query.mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1' }] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5')
      .send({});

    expect(res.status).toBe(400);
  });

  test('400 kalau password baru kurang dari 3 karakter', async () => {
    query.mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1' }] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5')
      .send({ password: 'ab' });

    expect(res.status).toBe(400);
  });

  test('sukses ganti description doang, TANPA nyentuh password cache sama sekali', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1' }] })
      .mockResolvedValueOnce({ rowsAffected: [1] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5')
      .send({ description: 'Gudang Utara' });

    expect(res.status).toBe(200);
    expect(cacheNewPassword).not.toHaveBeenCalled();
  });

  test('sukses ganti password: cache password ke-refresh dengan username yang benar', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1' }] })
      .mockResolvedValueOnce({ rowsAffected: [1] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5')
      .send({ password: 'passwordBaru123' });

    expect(res.status).toBe(200);
    expect(cacheNewPassword).toHaveBeenCalledWith('gudang1', 'passwordBaru123');
  });
});

describe('DELETE /api/users/:id', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau IT coba hapus akunnya SENDIRI', async () => {
    const res = await request(buildAppAsUser(itUser))
      .delete('/api/users/1');

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('404 kalau user target gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .delete('/api/users/999');

    expect(res.status).toBe(404);
  });

  test('sukses hapus user lain (bukan diri sendiri)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ id_user: 5, username: 'gudang1' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .delete('/api/users/5');

    expect(res.status).toBe(200);
    expect(res.body.deleted_user).toBe('gudang1');
  });
});

describe('PUT /api/users/:id/password (change own/other password)', () => {
  beforeEach(() => {
    query.mockReset();
    verifyLogin.mockReset();
    cacheNewPassword.mockReset();
  });

  test('403 kalau user BUKAN IT dan bukan ganti password DIRI SENDIRI', async () => {
    const gudangUser = { id_user: 5, username: 'gudang1', position: 'RECEIVING' };

    const res = await request(buildAppAsUser(gudangUser))
      .put('/api/users/7/password')
      .send({ new_password: 'baru123', confirm_password: 'baru123' });

    expect(res.status).toBe(403);
  });

  test('400 kalau new_password dan confirm_password gak sama', async () => {
    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5/password')
      .send({ new_password: 'baru123', confirm_password: 'beda456' });

    expect(res.status).toBe(400);
  });

  test('401 kalau ganti password SENDIRI tapi current_password salah', async () => {
    const gudangUser = { id_user: 5, username: 'gudang1', position: 'RECEIVING' };
    query.mockResolvedValueOnce({ recordset: [{ username: 'gudang1', password: 'passwordLama' }] });
    verifyLogin.mockResolvedValueOnce(false);

    const res = await request(buildAppAsUser(gudangUser))
      .put('/api/users/5/password')
      .send({ current_password: 'salah', new_password: 'baru123', confirm_password: 'baru123' });

    expect(res.status).toBe(401);
  });

  test('IT ganti password user LAIN: TIDAK perlu current_password sama sekali', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ username: 'gudang1', password: 'passwordLama' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(buildAppAsUser(itUser))
      .put('/api/users/5/password')
      .send({ new_password: 'baruDariIT', confirm_password: 'baruDariIT' });

    expect(res.status).toBe(200);
    expect(verifyLogin).not.toHaveBeenCalled();
    expect(cacheNewPassword).toHaveBeenCalledWith('gudang1', 'baruDariIT');
  });

  test('sukses ganti password sendiri dengan current_password yang benar', async () => {
    const gudangUser = { id_user: 5, username: 'gudang1', position: 'RECEIVING' };
    query
      .mockResolvedValueOnce({ recordset: [{ username: 'gudang1', password: 'passwordLama' }] })
      .mockResolvedValueOnce({ recordset: [] });
    verifyLogin.mockResolvedValueOnce(true);

    const res = await request(buildAppAsUser(gudangUser))
      .put('/api/users/5/password')
      .send({ current_password: 'passwordLama', new_password: 'passwordBaru', confirm_password: 'passwordBaru' });

    expect(res.status).toBe(200);
  });
});