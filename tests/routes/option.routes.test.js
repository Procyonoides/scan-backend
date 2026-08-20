jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));

const request = require('supertest');
const { query } = require('../../config/database');
const optionRouter = require('../../routes/option.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(optionRouter, '/api/options');

// Ketiga resource ini (model/size/production) punya bentuk CRUD yang PERSIS
// sama di option.routes.js (cuma beda nama tabel & nama field), jadi
// ditest pakai satu set skenario yang sama supaya konsisten & gak nulis 3x.
const resources = [
  { name: 'models', codeField: 'model_code', valueField: 'model', code: 'BST', value: 'BOOST' },
  { name: 'sizes', codeField: 'size_code', valueField: 'size', code: 'SZ10', value: '10' },
  { name: 'productions', codeField: 'production_code', valueField: 'production', code: 'HSK', value: 'PT HSK REMBANG' }
];

describe.each(resources)('$name CRUD', ({ name, codeField, valueField, code, value }) => {
  beforeEach(() => query.mockReset());

  describe(`GET /api/options/${name}`, () => {
    test('limit di-cap maksimal 100', async () => {
      query
        .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
        .mockResolvedValueOnce({ recordset: [] });

      await request(app).get(`/api/options/${name}?limit=99999`);

      expect(query.mock.calls[1][1].limit).toBe(100);
    });

    test('search dibungkus wildcard %...%', async () => {
      query
        .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
        .mockResolvedValueOnce({ recordset: [] });

      await request(app).get(`/api/options/${name}?search=abc`);

      expect(query.mock.calls[0][1].search).toBe('%abc%');
    });
  });

  describe(`POST /api/options/${name}`, () => {
    test('400 kalau code atau value kosong', async () => {
      const res = await request(app)
        .post(`/api/options/${name}`)
        .send({ [codeField]: code }); // valueField gak dikirim

      expect(res.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    test('400 kalau code udah ada (duplikat)', async () => {
      query.mockResolvedValueOnce({ recordset: [{ [codeField]: code }] });

      const res = await request(app)
        .post(`/api/options/${name}`)
        .send({ [codeField]: code, [valueField]: value });

      expect(res.status).toBe(400);
      expect(query).toHaveBeenCalledTimes(1); // gak lanjut INSERT
    });

    test('201 sukses insert baru', async () => {
      query
        .mockResolvedValueOnce({ recordset: [] }) // cek duplikat -> aman
        .mockResolvedValueOnce({ recordset: [] }); // INSERT

      const res = await request(app)
        .post(`/api/options/${name}`)
        .send({ [codeField]: code, [valueField]: value });

      expect(res.status).toBe(201);
      expect(query.mock.calls[1][0]).toMatch(/INSERT INTO/i);
    });
  });

  describe(`PUT /api/options/${name}/:code`, () => {
    test('400 kalau value kosong', async () => {
      const res = await request(app)
        .put(`/api/options/${name}/${code}`)
        .send({});

      expect(res.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    test('404 kalau code gak ada', async () => {
      query.mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .put(`/api/options/${name}/TIDAKADA`)
        .send({ [valueField]: 'BARU' });

      expect(res.status).toBe(404);
    });

    test('200 sukses update', async () => {
      query
        .mockResolvedValueOnce({ recordset: [{ [codeField]: code }] })
        .mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .put(`/api/options/${name}/${code}`)
        .send({ [valueField]: 'BARU' });

      expect(res.status).toBe(200);
    });
  });

  describe(`DELETE /api/options/${name}/:code`, () => {
    test('404 kalau code gak ada', async () => {
      query.mockResolvedValueOnce({ recordset: [] });

      const res = await request(app).delete(`/api/options/${name}/TIDAKADA`);

      expect(res.status).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('200 sukses delete', async () => {
      query
        .mockResolvedValueOnce({ recordset: [{ [codeField]: code }] })
        .mockResolvedValueOnce({ recordset: [] });

      const res = await request(app).delete(`/api/options/${name}/${code}`);

      expect(res.status).toBe(200);
    });
  });

  describe(`POST /api/options/${name}/batch-delete`, () => {
    test('400 kalau codes kosong / bukan array', async () => {
      const res = await request(app)
        .post(`/api/options/${name}/batch-delete`)
        .send({ codes: [] });

      expect(res.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    test('sukses hapus banyak sekaligus', async () => {
      query.mockResolvedValueOnce({ recordset: [] });

      const res = await request(app)
        .post(`/api/options/${name}/batch-delete`)
        .send({ codes: [code, 'CODE2'] });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });
  });
});
