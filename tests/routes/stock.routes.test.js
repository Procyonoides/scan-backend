jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));
jest.mock('../../utils/warehouseStats', () => ({
  getWarehouseStats: jest.fn()
}));

const request = require('supertest');
const { query } = require('../../config/database');
const { getWarehouseStats } = require('../../utils/warehouseStats');
const stockRouter = require('../../routes/stock.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(stockRouter, '/api/stocks');

describe('GET /api/stocks', () => {
  beforeEach(() => query.mockReset());

  test('tanpa search: query dijalankan TANPA filter search parameter', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/stocks');

    expect(res.status).toBe(200);
    const countCallParams = query.mock.calls[0][1];
    expect(countCallParams).toEqual({});
  });

  test('dengan search: parameter di-wrap dengan wildcard %...%', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 1 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/stocks?search=boost');

    const countCallParams = query.mock.calls[0][1];
    expect(countCallParams.search).toBe('%boost%');
  });

  test('pagination: limit di-cap maksimal 100 walau diminta lebih', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 0 }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app).get('/api/stocks?limit=99999');

    const dataCallParams = query.mock.calls[1][1];
    expect(dataCallParams.limit).toBe(100);
  });

  test('response include pagination info yang benar', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ total: 25 }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).get('/api/stocks?page=2&limit=10');

    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });
});

describe('GET /api/stocks/warehouse-stats (versi yang udah difix)', () => {
  beforeEach(() => {
    query.mockReset();
    getWarehouseStats.mockReset();
  });

  test('first_stock dan warehouse_stock harus BEDA (bukan bug lama yang identik)', async () => {
    getWarehouseStats.mockResolvedValueOnce({
      firstStock: 900,
      warehouseStock: 1000,
      receivingCount: 3,
      shippingCount: 1,
      warehouseItems: []
    });

    const res = await request(app).get('/api/stocks/warehouse-stats');

    expect(res.status).toBe(200);
    expect(res.body.first_stock).toBe(900);
    expect(res.body.warehouse_stock).toBe(1000);
    expect(res.body.first_stock).not.toBe(res.body.warehouse_stock);
  });

  test('pakai helper yang SAMA dengan dashboard (satu sumber kebenaran)', async () => {
    getWarehouseStats.mockResolvedValueOnce({
      firstStock: 1, warehouseStock: 2, receivingCount: 0, shippingCount: 0, warehouseItems: []
    });

    await request(app).get('/api/stocks/warehouse-stats');

    expect(getWarehouseStats).toHaveBeenCalledWith(query, 'TestDB');
  });
});

describe('GET /api/stocks/chart-data', () => {
  beforeEach(() => query.mockReset());

  test('balikin data 7 hari apa adanya dari query', async () => {
    query.mockResolvedValueOnce({
      recordset: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-01-0${i + 1}`,
        receiving: i,
        shipping: i
      }))
    });

    const res = await request(app).get('/api/stocks/chart-data');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
  });
});