jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
// verifyRole di sini di-bypass total (selalu izinin) - fokus test ini ke logic
// di dalam handler-nya (validasi barcode, hitung stock, dst), bukan ke middleware auth
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));

const request = require('supertest');
const { query } = require('../../config/database');
const receivingRouter = require('../../routes/receiving.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(receivingRouter, '/api/receiving');

const fakeMasterData = {
  original_barcode: 'ABC123',
  brand: 'NEW BALANCE',
  color: 'BLACK',
  size: '10',
  four_digit: '0010',
  unit: 'PRS',
  quantity: 12,
  production: 'PT HSK REMBANG',
  model: 'BOOST',
  model_code: 'BST',
  item: 'IP'
};

describe('POST /api/receiving/scan', () => {
  beforeEach(() => {
    query.mockReset();
    // Pastikan waktu sistem di luar jam maintenance (07:30:00-07:30:06)
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T10:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('400 kalau barcode kosong', async () => {
    const res = await request(app)
      .post('/api/receiving/scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: '' });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('403 kalau posisi user bukan RECEIVING atau IT', async () => {
    const res = await request(app)
      .post('/api/receiving/scan')
      .set('x-test-position', 'SHIPPING') // posisi salah buat receiving
      .send({ barcode: 'ABC123' });

    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  test('404 kalau barcode gak ketemu di master data', async () => {
    query.mockResolvedValueOnce({ recordset: [] }); // master data lookup -> kosong

    const res = await request(app)
      .post('/api/receiving/scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'TIDAKADA' });

    expect(res.status).toBe(404);
  });

  test('503 kalau lagi jam maintenance (07:30:00-07:30:06)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T07:30:03'));

    const res = await request(app)
      .post('/api/receiving/scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'ABC123' });

    expect(res.status).toBe(503);
    expect(query).not.toHaveBeenCalled(); // gak sempet nyentuh database sama sekali
  });

  test('201 sukses: stock DITAMBAH sejumlah quantity barcode, scan_no lanjut dari terakhir', async () => {
    query
      .mockResolvedValueOnce({ recordset: [fakeMasterData] })       // master data lookup
      .mockResolvedValueOnce({ recordset: [{ description: 'Gudang A' }] }) // user lookup
      .mockResolvedValueOnce({ recordset: [{ max_scan_no: 5 }] })   // scan_no terakhir hari ini = 5
      .mockResolvedValueOnce({ recordset: [] })                     // UPDATE stock
      .mockResolvedValueOnce({ recordset: [] });                    // INSERT receiving

    const res = await request(app)
      .post('/api/receiving/scan')
      .set('x-test-position', 'RECEIVING')
      .set('x-test-username', 'gudang1')
      .send({ barcode: 'ABC123' });

    expect(res.status).toBe(201);
    expect(res.body.data.scan_no).toBe(6); // lanjut dari 5

    // Cek query UPDATE stock: harus NAMBAH (stock + @quantity), bukan ngurangin
    const updateCall = query.mock.calls[3];
    expect(updateCall[0]).toMatch(/stock\s*=\s*stock\s*\+\s*@quantity/i);
    expect(updateCall[1].quantity).toBe(fakeMasterData.quantity);

    // Cek query INSERT beneran jalan dengan data yang benar
    const insertCall = query.mock.calls[4];
    expect(insertCall[0]).toMatch(/INSERT INTO/i);
    expect(insertCall[1].original_barcode).toBe('ABC123');
    expect(insertCall[1].scan_no).toBe(6);
  });
});

describe('POST /api/receiving/batch-scan', () => {
  beforeEach(() => {
    query.mockReset();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T10:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('400 kalau batchCount kurang dari 1', async () => {
    const res = await request(app)
      .post('/api/receiving/batch-scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'ABC123', batchCount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BATCH_COUNT');
  });

  test('400 kalau batchCount lebih dari 1000', async () => {
    const res = await request(app)
      .post('/api/receiving/batch-scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'ABC123', batchCount: 1001 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BATCH_COUNT');
  });

  test('201 sukses: total quantity = quantity per-item x batchCount, stock nambah sesuai total', async () => {
    query
      .mockResolvedValueOnce({ recordset: [fakeMasterData] })
      .mockResolvedValueOnce({ recordset: [{ description: 'Gudang A' }] })
      .mockResolvedValueOnce({ recordset: [{ max_scan_no: 0 }] })
      .mockResolvedValueOnce({ recordset: [] }) // UPDATE stock
      .mockResolvedValueOnce({ recordset: [] }); // INSERT bulk

    const res = await request(app)
      .post('/api/receiving/batch-scan')
      .set('x-test-position', 'RECEIVING')
      .set('x-test-username', 'gudang1')
      .send({ barcode: 'ABC123', batchCount: 10 });

    expect(res.status).toBe(201);
    expect(res.body.data.totalQuantity).toBe(fakeMasterData.quantity * 10); // 12 x 10 = 120

    const updateCall = query.mock.calls[3];
    expect(updateCall[1].quantity).toBe(120);

    // Query INSERT bulk-nya harus punya 10 baris (dipisah koma jadi 10 grup nilai)
    const insertSql = query.mock.calls[4][0];
    const rowCount = (insertSql.match(/GETDATE\(\)/g) || []).length;
    expect(rowCount).toBe(10);
  });

  test('404 kalau barcode gak ketemu, dan stock TIDAK di-update sama sekali', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/receiving/batch-scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'TIDAKADA', batchCount: 5 });

    expect(res.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1); // cuma lookup, gak lanjut ke UPDATE/INSERT
  });
});