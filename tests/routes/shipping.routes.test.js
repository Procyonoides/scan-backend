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
const shippingRouter = require('../../routes/shipping.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(shippingRouter, '/api/shipping');

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
  item: 'IP',
  stock: 5 // sengaja LEBIH KECIL dari quantity (12), buat tes stock gak cukup
};

describe('POST /api/shipping/scan', () => {
  beforeEach(() => {
    query.mockReset();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T10:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('400 kalau barcode kosong', async () => {
    const res = await request(app)
      .post('/api/shipping/scan')
      .set('x-test-position', 'SHIPPING')
      .send({ barcode: '' });

    expect(res.status).toBe(400);
  });

  test('403 kalau posisi user bukan SHIPPING atau IT', async () => {
    const res = await request(app)
      .post('/api/shipping/scan')
      .set('x-test-position', 'RECEIVING')
      .send({ barcode: 'ABC123' });

    expect(res.status).toBe(403);
  });

  test('404 kalau barcode gak ketemu', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/shipping/scan')
      .set('x-test-position', 'SHIPPING')
      .send({ barcode: 'TIDAKADA' });

    expect(res.status).toBe(404);
  });

  test('201 sukses: stock DIKURANGI sejumlah quantity barcode', async () => {
    query
      .mockResolvedValueOnce({ recordset: [fakeMasterData] })
      .mockResolvedValueOnce({ recordset: [{ description: 'Gudang A' }] })
      .mockResolvedValueOnce({ recordset: [{ max_scan_no: 2 }] })
      .mockResolvedValueOnce({ recordset: [] }) // UPDATE stock
      .mockResolvedValueOnce({ recordset: [] }); // INSERT shipping

    const res = await request(app)
      .post('/api/shipping/scan')
      .set('x-test-position', 'SHIPPING')
      .set('x-test-username', 'gudang2')
      .send({ barcode: 'ABC123' });

    expect(res.status).toBe(201);

    const updateCall = query.mock.calls[3];
    expect(updateCall[0]).toMatch(/stock\s*=\s*stock\s*-\s*@quantity/i);
    expect(updateCall[1].quantity).toBe(fakeMasterData.quantity);
  });

  /**
   * ⚠️ TEMUAN: endpoint single-scan ini TIDAK ngecek apa stock cukup sebelum
   * dikurangi (beda sama /batch-scan yang punya pengecekan itu). Artinya
   * kalau stock di master_database cuma 5, terus di-scan shipping barang
   * yang quantity-nya 12, stock bakal jebol jadi MINUS (-7) tanpa penolakan.
   *
   * Test ini sengaja ditulis buat DOKUMENTASIIN kondisi apa adanya sekarang
   * (bukan berarti ini perilaku yang benar) - kalau nanti dibenerin (nambah
   * pengecekan stock kayak di batch-scan), test ini PERLU diupdate jadi
   * expect(res.status).toBe(400) juga.
   */
  test('⚠️ SAAT INI: stock tetap dikurangi walau jadi MINUS (belum ada pengecekan stock cukup di single-scan)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [fakeMasterData] }) // stock cuma 5, quantity 12
      .mockResolvedValueOnce({ recordset: [{ description: '' }] })
      .mockResolvedValueOnce({ recordset: [{ max_scan_no: 0 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/shipping/scan')
      .set('x-test-position', 'SHIPPING')
      .send({ barcode: 'ABC123' });

    // Perilaku SAAT INI: tetap 201 sukses, gak ditolak walau stock bakal minus
    expect(res.status).toBe(201);
  });
});

describe('POST /api/shipping/batch-scan', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('400 "Insufficient stock" kalau stock gak cukup buat batch', async () => {
    query.mockResolvedValueOnce({ recordset: [fakeMasterData] }); // stock 5, quantity 12 x batchCount 3 = 36 dibutuhkan

    const res = await request(app)
      .post('/api/shipping/batch-scan')
      .set('x-test-position', 'SHIPPING')
      .send({ barcode: 'ABC123', batchCount: 3 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient stock/i);
    // Gak lanjut ke UPDATE/INSERT sama sekali kalau stock gak cukup
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('201 sukses kalau stock cukup, stock dikurangi sesuai total', async () => {
    const cukupStock = { ...fakeMasterData, stock: 100 };
    query
      .mockResolvedValueOnce({ recordset: [cukupStock] })
      .mockResolvedValueOnce({ recordset: [{ description: '' }] })
      .mockResolvedValueOnce({ recordset: [{ max_scan_no: 0 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .post('/api/shipping/batch-scan')
      .set('x-test-position', 'SHIPPING')
      .send({ barcode: 'ABC123', batchCount: 3 });

    expect(res.status).toBe(201);
    const updateCall = query.mock.calls[3];
    expect(updateCall[1].quantity).toBe(cukupStock.quantity * 3); // 36
  });
});