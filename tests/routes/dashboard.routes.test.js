jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));
// getWarehouseStats sudah ditest terpisah (tests/utils/warehouseStats.test.js),
// di sini cukup di-mock supaya test route fokus ke wiring-nya, bukan ulang isi logic-nya
jest.mock('../../utils/warehouseStats', () => ({
  getWarehouseStats: jest.fn()
}));

const request = require('supertest');
const { query } = require('../../config/database');
const { getWarehouseStats } = require('../../utils/warehouseStats');
const dashboardRouter = require('../../routes/dashboard.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(dashboardRouter, '/api/dashboard');

describe('GET /api/dashboard/warehouse-stats', () => {
  beforeEach(() => {
    query.mockReset();
    getWarehouseStats.mockReset();
  });

  test('nge-mapping hasil getWarehouseStats() ke field response yang benar (snake_case)', async () => {
    getWarehouseStats.mockResolvedValueOnce({
      firstStock: 900,
      warehouseStock: 1000,
      receivingCount: 5,
      receivingQty: 50,
      shippingCount: 2,
      shippingQty: 20,
      warehouseItems: []
    });

    const res = await request(app).get('/api/dashboard/warehouse-stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      first_stock: 900,
      receiving: 5,
      receiving_qty: 50,
      shipping: 2,
      shipping_qty: 20,
      warehouse_stock: 1000
    });
  });

  test('500 kalau getWarehouseStats() gagal (misal database down)', async () => {
    getWarehouseStats.mockRejectedValueOnce(new Error('Connection timeout'));

    const res = await request(app).get('/api/dashboard/warehouse-stats');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/dashboard/daily-chart', () => {
  beforeEach(() => query.mockReset());

  test('data di-reverse jadi urutan ASCENDING (lama ke baru), padahal query-nya DESC', async () => {
    query.mockResolvedValueOnce({
      recordset: [
        { date: '2026-01-07', receiving: 7, shipping: 7 },
        { date: '2026-01-06', receiving: 6, shipping: 6 },
        { date: '2026-01-05', receiving: 5, shipping: 5 }
      ]
    });

    const res = await request(app).get('/api/dashboard/daily-chart');

    expect(res.status).toBe(200);
    expect(res.body[0].date).toBe('2026-01-05');
    expect(res.body[2].date).toBe('2026-01-07');
  });
});

describe('GET /api/dashboard/shift-scan', () => {
  beforeEach(() => query.mockReset());

  test('query pakai cutoff kemarin jam 07:30:00 (bukan hari ini)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T10:00:00'));
    query.mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/dashboard/shift-scan');

    const params = query.mock.calls[0][1];

    // Hitung ulang PERSIS kayak logic di route (bukan asumsi string UTC),
    // supaya test ini gak gagal cuma gara-gara beda zona waktu komputer
    // (kemarin ketauan gagal di komputer WIB/UTC+7, karena 07:30:00
    // lokal jadi 00:30:00 kalau di-toISOString()).
    const expectedYesterday = new Date('2026-08-14T10:00:00');
    expectedYesterday.setDate(expectedYesterday.getDate() - 1);
    expectedYesterday.setHours(7, 30, 0, 0);
    const expectedStr = expectedYesterday.toISOString().slice(0, 19).replace('T', ' ');

    expect(params.yesterday).toBe(expectedStr);

    jest.useRealTimers();
  });

  test('balikin data per-username apa adanya dari query', async () => {
    query.mockResolvedValueOnce({
      recordset: [{ username: 'gudang1', status: 60, percent: '60,00', total: 600 }]
    });

    const res = await request(app).get('/api/dashboard/shift-scan');

    expect(res.status).toBe(200);
    expect(res.body[0].username).toBe('gudang1');
  });
});

describe('GET /api/dashboard/warehouse-items', () => {
  beforeEach(() => query.mockReset());

  test('balikin data chart per item apa adanya', async () => {
    query.mockResolvedValueOnce({
      recordset: [
        { item: 'IP', status: 60, total: 600 },
        { item: 'TKC', status: 40, total: 400 }
      ]
    });

    const res = await request(app).get('/api/dashboard/warehouse-items');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].item).toBe('IP');
  });
});

describe('GET /api/dashboard/receiving-list & shipping-list', () => {
  beforeEach(() => query.mockReset());

  test('receiving-list balikin data terbaru duluan', async () => {
    query.mockResolvedValueOnce({
      recordset: [{ original_barcode: 'ABC123', scan_no: 5 }]
    });

    const res = await request(app).get('/api/dashboard/receiving-list');

    expect(res.status).toBe(200);
    expect(res.body[0].original_barcode).toBe('ABC123');
  });

  test('shipping-list balikin data terbaru duluan', async () => {
    query.mockResolvedValueOnce({
      recordset: [{ original_barcode: 'XYZ789', scan_no: 3 }]
    });

    const res = await request(app).get('/api/dashboard/shipping-list');

    expect(res.status).toBe(200);
    expect(res.body[0].original_barcode).toBe('XYZ789');
  });
});