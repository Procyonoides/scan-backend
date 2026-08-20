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
const transactionRouter = require('../../routes/transaction.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(transactionRouter, '/api/transactions');

describe('GET /api/transactions', () => {
  beforeEach(() => query.mockReset());

  test('tanpa search: gak ada filter tanggal', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/transactions');

    expect(res.status).toBe(200);
    expect(query.mock.calls[0][1]).toEqual({});
  });

  test('dengan search: cari berdasarkan tanggal, wildcard %...%', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 1 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/transactions?search=2026-01');

    expect(query.mock.calls[0][1].search).toBe('%2026-01%');
  });

  test('limit di-cap maksimal 100', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/transactions?limit=99999');

    expect(query.mock.calls[1][1].limit).toBe(100);
  });
});

describe('GET /api/transactions/:no', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau nomor transaksi gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/transactions/999');

    expect(res.status).toBe(404);
  });

  test('200 sukses balikin detail transaksi', async () => {
    query.mockResolvedValueOnce({
      recordset: [{ no: 5, stock_awal: 900, receiving: 50, shipping: 20, stock_akhir: 930, date: '2026-01-05' }]
    });

    const res = await request(app).get('/api/transactions/5');

    expect(res.status).toBe(200);
    expect(res.body.data.stock_akhir).toBe(930);
  });
});

describe('PUT /api/transactions/:no', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau transaksi gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/transactions/999')
      .send({ stock_akhir: 1000 });

    expect(res.status).toBe(404);
  });

  test('400 kalau gak ada field yang dikirim', async () => {
    query.mockResolvedValueOnce({ recordset: [{ no: 5 }] });

    const res = await request(app)
      .put('/api/transactions/5')
      .send({});

    expect(res.status).toBe(400);
  });

  test('update SEBAGIAN field doang: yang gak dikirim gak ikut ke-update query', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ no: 5 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app)
      .put('/api/transactions/5')
      .send({ stock_akhir: 1200 });

    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toMatch(/stock_akhir = @stock_akhir/);
    expect(updateCall[0]).not.toMatch(/stock_awal = @stock_awal/);
    expect(updateCall[1].stock_akhir).toBe(1200);
  });

  test('semua angka di-parseInt (gak kesimpen sebagai string)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ no: 5 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app)
      .put('/api/transactions/5')
      .send({ stock_awal: '900', receiving: '50', shipping: '20', stock_akhir: '930' });

    const params = query.mock.calls[1][1];
    expect(params.stock_awal).toBe(900);
    expect(params.receiving).toBe(50);
    expect(typeof params.stock_awal).toBe('number');
  });
});

describe('DELETE /api/transactions/:no', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau transaksi gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).delete('/api/transactions/999');

    expect(res.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('200 sukses hapus', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ no: 5 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).delete('/api/transactions/5');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/transactions/batch-delete', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau nos kosong / bukan array', async () => {
    const res = await request(app)
      .post('/api/transactions/batch-delete')
      .send({ nos: [] });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('sukses hapus banyak transaksi sekaligus', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/transactions/batch-delete')
      .send({ nos: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    const deleteCall = query.mock.calls[0];
    expect(deleteCall[1]).toEqual({ no0: 1, no1: 2, no2: 3 });
  });
});

describe('GET /api/transactions/export/excel', () => {
  beforeEach(() => query.mockReset());

  test('response berupa CSV dengan header kolom yang benar', async () => {
    query.mockResolvedValueOnce({
      recordset: [
        { no: 1, date: '2026-01-01', stock_awal: 900, receiving: 50, shipping: 20, stock_akhir: 930 }
      ]
    });

    const res = await request(app).get('/api/transactions/export/excel');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('NO,DATE/TIME,FIRST STOCK,RECEIVING,SHIPPING,WAREHOUSE STOCK');
    expect(res.text).toContain('1,2026-01-01,900,50,20,930');
  });
});
