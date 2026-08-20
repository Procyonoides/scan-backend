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
const reportRouter = require('../../routes/report.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(reportRouter, '/api/reports');

describe('GET /api/reports/daily', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau tipe gak dikirim', async () => {
    const res = await request(app).get('/api/reports/daily');

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('tipe=receiving -> baca dari tabel data_receiving + receiving (arsip + live)', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=receiving');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/data_receiving/);
    expect(sql).toMatch(/\breceiving\b/);
  });

  test('tipe=shipping -> baca dari tabel data_shipping + shipping', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=shipping');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/data_shipping/);
  });

  test('rentang tanggal pakai cutoff 07:30:00 - 07:29:59 (bukan 00:00-23:59)', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    const params = query.mock.calls[0][1];
    expect(params.start_date).toBe('2026-01-01 07:30:00');
    expect(params.end_date).toBe('2026-01-31 07:29:59');
  });

  test('tanggal1/tanggal2 = "n" (placeholder "semua tanggal") TIDAK dianggap filter', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=receiving&tanggal1=n&tanggal2=n');

    const params = query.mock.calls[0][1];
    expect(params.start_date).toBeUndefined();
  });

  test('filter color: underscore di URL diubah jadi spasi', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=receiving&color=TEAM_ROYAL_COLORO');

    const params = query.mock.calls[0][1];
    expect(params.color).toBe('TEAM ROYAL COLORO');
  });

  test('filter color/model/size/user = "n" (placeholder) diabaikan, gak ikut WHERE', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/daily?tipe=receiving&model=n&color=n&size=n&user=n');

    const sql = query.mock.calls[0][0];
    expect(sql).not.toMatch(/WHERE/);
  });
});

describe('GET /api/reports/monthly', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau tipe gak dikirim', async () => {
    const res = await request(app).get('/api/reports/monthly');
    expect(res.status).toBe(400);
  });

  test('SELALU filter description IN (INCOME, SAMPLE), walau gak ada filter lain', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/monthly?tipe=receiving');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/description IN \('INCOME', 'SAMPLE'\)/);
  });

  test('data di-GROUP BY dan di-SUM per kombinasi model+color+size', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/reports/monthly?tipe=receiving');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/GROUP BY production, brand, model, color, size, description/);
    expect(sql).toMatch(/SUM\(quantity\) as total/);
  });
});

describe('GET /api/reports/filter-options', () => {
  beforeEach(() => query.mockReset());

  test('balikin models/colors/sizes/users sebagai array sederhana (bukan array object)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ model_code: 'BST', model: 'BOOST' }] })
      .mockResolvedValueOnce({ recordset: [{ color: 'BLACK' }, { color: 'WHITE' }] })
      .mockResolvedValueOnce({ recordset: [{ size: '10' }] })
      .mockResolvedValueOnce({ recordset: [{ username: 'gudang1' }] });

    const res = await request(app).get('/api/reports/filter-options');

    expect(res.status).toBe(200);
    expect(res.body.colors).toEqual(['BLACK', 'WHITE']);
    expect(res.body.users).toEqual(['gudang1']);
  });
});

describe('GET /api/reports/daily/export', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau tipe gak dikirim', async () => {
    const res = await request(app).get('/api/reports/daily/export');
    expect(res.status).toBe(400);
  });

  test('404 kalau gak ada data buat di-export', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/reports/daily/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    expect(res.status).toBe(404);
  });

  test('200 sukses: file XLSX ke-generate dengan content-type & filename yang benar', async () => {
    query.mockResolvedValueOnce({
      recordset: [{ 'SCAN NO': 1, 'DATE/TIME': '2026-01-01 08:00:00', QUANTITY: 12 }]
    });

    const res = await request(app).get('/api/reports/daily/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/Detail_Daily_RECEIVING_2026-01-01\.xlsx/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });
});

describe('GET /api/reports/monthly/export', () => {
  beforeEach(() => query.mockReset());

  test('200 sukses generate file, grand total dihitung tanpa error', async () => {
    query.mockResolvedValueOnce({
      recordset: [
        { model: 'A', color: 'X', TOTAL: 100 },
        { model: 'B', color: 'Y', TOTAL: 250 }
      ]
    });

    const res = await request(app).get('/api/reports/monthly/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  test('404 kalau data kosong', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/reports/monthly/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/reports/summary/export (pivot per ukuran)', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau tipe gak dikirim', async () => {
    const res = await request(app).get('/api/reports/summary/export');
    expect(res.status).toBe(400);
  });

  test('200 sukses generate pivot table XLSX', async () => {
    query.mockResolvedValueOnce({
      recordset: [
        { model: 'X', color: 'X', description: 'GRAND TOTAL', size_1: 5, TOTAL: 5 },
        { model: 'BOOST', color: 'BLACK', description: 'INCOME', size_1: 5, TOTAL: 5 }
      ]
    });

    const res = await request(app).get('/api/reports/summary/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-31');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

describe('GET /api/reports/hourly/export', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau data kosong', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/reports/hourly/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-01&jam1=07:00&jam2=15:00');

    expect(res.status).toBe(404);
  });

  test('rentang jam dipakai persis sesuai input (bukan cutoff 07:30 tetap)', async () => {
    query.mockResolvedValueOnce({ recordset: [{ 'DATE/TIME': 'x' }] });

    await request(app).get('/api/reports/hourly/export?tipe=receiving&tanggal1=2026-01-01&tanggal2=2026-01-01&jam1=09:00:00&jam2=17:00:00');

    const params = query.mock.calls[0][1];
    expect(params.start).toBe('2026-01-01 09:00:00');
    expect(params.end).toBe('2026-01-01 17:00:00');
  });
});
