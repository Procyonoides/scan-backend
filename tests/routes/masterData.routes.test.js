jest.mock('../../config/database', () => ({
  query: jest.fn(),
  dbName: 'TestDB'
}));
jest.mock('../../middleware/auth.middleware', () => ({
  verifyToken: (req, res, next) => next(),
  verifyRole: () => (req, res, next) => next()
}));
// runInTransaction udah ada test sendiri (tests/utils/transaction.test.js),
// di sini cukup di-mock supaya callback-nya jalan pakai txQuery yang sama
// kayak mock query() biasa - jadi test route bisa kontrol urutan hasil query
// persis kayak endpoint lain, tanpa perlu ngerti detail mssql Transaction.
const mockTxQuery = jest.fn();
jest.mock('../../utils/transaction', () => ({
  runInTransaction: jest.fn((callback) => callback(mockTxQuery))
}));

const request = require('supertest');
const { query } = require('../../config/database');
const masterDataRouter = require('../../routes/masterData.routes');
const { createTestApp } = require('../helpers/testApp');

const app = createTestApp(masterDataRouter, '/api/master-data');

const validBarcodePayload = {
  original_barcode: 'NEW001',
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

describe('POST /api/master-data/barcode (create)', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau ada field wajib yang kosong', async () => {
    const res = await request(app)
      .post('/api/master-data/barcode')
      .send({ original_barcode: 'X' }); // sisanya gak diisi

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('400 kalau barcode udah ada', async () => {
    query.mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] }); // udah ada

    const res = await request(app)
      .post('/api/master-data/barcode')
      .send(validBarcodePayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
    expect(query).toHaveBeenCalledTimes(1); // cuma cek doang, gak lanjut INSERT
  });

  test('201 sukses: barcode baru ke-insert dengan stock AWAL = 0', async () => {
    query
      .mockResolvedValueOnce({ recordset: [] }) // cek duplikat -> aman
      .mockResolvedValueOnce({ recordset: [] }); // INSERT

    const res = await request(app)
      .post('/api/master-data/barcode')
      .send(validBarcodePayload);

    expect(res.status).toBe(201);

    const insertCall = query.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO/i);
    expect(insertCall[0]).toMatch(/stock\)/i); // kolom stock di-set eksplisit
    expect(insertCall[0]).toMatch(/,\s*0\s*\)/); // ...ke nilai 0 (barang baru belum ada stok)
  });
});

describe('PUT /api/master-data/barcode/:barcode (update)', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau barcode gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/master-data/barcode/TIDAKADA')
      .send({ brand: 'ADIDAS' });

    expect(res.status).toBe(404);
  });

  test('400 kalau body kosong (gak ada field yang mau diubah)', async () => {
    query.mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] });

    const res = await request(app)
      .put('/api/master-data/barcode/NEW001')
      .send({});

    expect(res.status).toBe(400);
  });

  test('update SEBAGIAN field doang: field yang gak dikirim gak ikut ke-update', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/master-data/barcode/NEW001')
      .send({ brand: 'ADIDAS' }); // cuma ganti brand

    expect(res.status).toBe(200);

    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toMatch(/brand = @brand/);
    expect(updateCall[0]).not.toMatch(/color = @color/); // gak dikirim, gak ikut di-update
    expect(updateCall[1].brand).toBe('ADIDAS');
  });

  test('bisa update stock secara manual (misal buat koreksi stock opname)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/master-data/barcode/NEW001')
      .send({ stock: 500 });

    expect(res.status).toBe(200);
    const updateCall = query.mock.calls[1];
    expect(updateCall[1].stock).toBe(500);
  });

  test('username & date_time SELALU ke-update walau cuma ganti 1 field (jejak siapa yang edit terakhir)', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] })
      .mockResolvedValueOnce({ recordset: [] });

    await request(app)
      .put('/api/master-data/barcode/NEW001')
      .send({ item: 'TKC' });

    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toMatch(/username\s*=\s*@username/);
    expect(updateCall[0]).toMatch(/date_time\s*=\s*GETDATE\(\)/);
  });
});

describe('DELETE /api/master-data/barcode/:barcode', () => {
  beforeEach(() => query.mockReset());

  test('404 kalau barcode gak ada', async () => {
    query.mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).delete('/api/master-data/barcode/TIDAKADA');

    expect(res.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1); // gak lanjut ke DELETE
  });

  test('200 sukses hapus barcode yang ada', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'NEW001' }] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app).delete('/api/master-data/barcode/NEW001');

    expect(res.status).toBe(200);
    expect(res.body.deleted_barcode).toBe('NEW001');
  });
});

describe('POST /api/master-data/batch-delete', () => {
  beforeEach(() => query.mockReset());

  test('400 kalau input bukan array / array kosong', async () => {
    const res = await request(app)
      .post('/api/master-data/batch-delete')
      .send({ barcodes: [] });

    expect(res.status).toBe(400);
  });

  test('400 kalau lebih dari 100 barcode sekaligus', async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `BC${i}`);

    const res = await request(app)
      .post('/api/master-data/batch-delete')
      .send({ barcodes: tooMany });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test('barcode yang gak ketemu masuk ke "errors", yang ketemu tetap kehapus (gak saling gagalin)', async () => {
    query
      // barcode pertama: ADA
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ADA1' }] })
      .mockResolvedValueOnce({ recordset: [] }) // DELETE ADA1
      // barcode kedua: GAK ADA
      .mockResolvedValueOnce({ recordset: [] })
      // barcode ketiga: ADA
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ADA3' }] })
      .mockResolvedValueOnce({ recordset: [] }); // DELETE ADA3

    const res = await request(app)
      .post('/api/master-data/batch-delete')
      .send({ barcodes: ['ADA1', 'GAKADA', 'ADA3'] });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(2);
    expect(res.body.errorCount).toBe(1);
    expect(res.body.deletedBarcodes).toEqual(['ADA1', 'ADA3']);
    expect(res.body.errors[0]).toMatch(/GAKADA/);
  });

  test('satu barcode gagal (misal error database) TIDAK menghentikan proses barcode lainnya', async () => {
    query
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ADA1' }] })
      .mockRejectedValueOnce(new Error('Constraint violation')) // DELETE ADA1 gagal
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ADA2' }] })
      .mockResolvedValueOnce({ recordset: [] }); // DELETE ADA2 sukses

    const res = await request(app)
      .post('/api/master-data/batch-delete')
      .send({ barcodes: ['ADA1', 'ADA2'] });

    expect(res.status).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(res.body.errorCount).toBe(1);
    expect(res.body.deletedBarcodes).toEqual(['ADA2']); // ADA1 gagal, ADA2 tetap kehapus
  });
});

describe('PUT /api/master-data/record (edit record + sinkron stock)', () => {
  beforeEach(() => mockTxQuery.mockReset());

  test('404 kalau record gak ketemu di tabel manapun (active/archive/backup)', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [] }) // cek tabel 'receiving'
      .mockResolvedValueOnce({ recordset: [] }) // cek tabel 'data_receiving'
      .mockResolvedValueOnce({ recordset: [] }); // cek tabel 'backup_receiving'

    const res = await request(app)
      .put('/api/master-data/record')
      .send({ type: 'receiving', dateTime: '2026-01-01 10:00:00', scanNo: 5, oldUsername: 'gudang1', quantity: 10, username: 'gudang1', description: 'INCOME' });

    expect(res.status).toBe(404);
  });

  test('receiving: quantity NAIK -> stock ikut NAIK sebesar selisihnya', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ABC123', quantity: 10 }] }) // ketemu di tabel aktif, quantity lama = 10
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] }) // UPDATE record
      .mockResolvedValueOnce({ recordset: [] }); // UPDATE stock

    const res = await request(app)
      .put('/api/master-data/record')
      .send({ type: 'receiving', dateTime: '2026-01-01 10:00:00', scanNo: 5, oldUsername: 'gudang1', quantity: 15, username: 'gudang1', description: 'INCOME' });

    expect(res.status).toBe(200);
    expect(res.body.stockAdjustment).toBe(5); // 15 - 10 = +5, receiving -> stock naik

    const stockUpdateCall = mockTxQuery.mock.calls[2];
    expect(stockUpdateCall[0]).toMatch(/stock = stock \+ @stockAdjustment/);
    expect(stockUpdateCall[1]).toEqual({ stockAdjustment: 5, barcode: 'ABC123' });
  });

  test('shipping: quantity NAIK -> stock malah TURUN (kebalikan dari receiving)', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ABC123', quantity: 10 }] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .put('/api/master-data/record')
      .send({ type: 'shipping', dateTime: '2026-01-01 10:00:00', scanNo: 5, oldUsername: 'gudang2', quantity: 15, username: 'gudang2', description: 'OUT' });

    expect(res.status).toBe(200);
    expect(res.body.stockAdjustment).toBe(-5); // shipping naik 5 -> stock turun 5
  });

  test('quantity SAMA (gak berubah) -> stock TIDAK ikut di-update sama sekali', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ABC123', quantity: 10 }] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [1] });
      // TIDAK ada mock ke-4 buat UPDATE stock, karena harusnya emang gak dipanggil

    const res = await request(app)
      .put('/api/master-data/record')
      .send({ type: 'receiving', dateTime: '2026-01-01 10:00:00', scanNo: 5, oldUsername: 'gudang1', quantity: 10, username: 'gudang1', description: 'INCOME' });

    expect(res.status).toBe(200);
    expect(mockTxQuery).toHaveBeenCalledTimes(2); // cuma cari + update record, gak ada update stock
  });
});

describe('DELETE /api/master-data/record (hapus record + sinkron stock)', () => {
  beforeEach(() => mockTxQuery.mockReset());

  test('404 kalau record gak ketemu', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .delete('/api/master-data/record')
      .query({ type: 'receiving', dateTime: '2026-01-01 10:00:00', scanNo: 5, username: 'gudang1' });

    expect(res.status).toBe(404);
  });

  test('hapus record RECEIVING -> stock DIKURANGI sejumlah quantity yang dihapus', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ABC123', quantity: 12 }] })
      .mockResolvedValueOnce({ recordset: [] }) // DELETE record
      .mockResolvedValueOnce({ recordset: [] }); // UPDATE stock

    const res = await request(app)
      .delete('/api/master-data/record')
      .query({ type: 'receiving', dateTime: '2026-01-01 10:00:00', scanNo: 5, username: 'gudang1' });

    expect(res.status).toBe(200);
    expect(res.body.stockAdjustment).toBe(-12);
  });

  test('hapus record SHIPPING -> stock DIKEMBALIKAN (ditambah) sejumlah quantity yang dihapus', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [{ original_barcode: 'ABC123', quantity: 12 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const res = await request(app)
      .delete('/api/master-data/record')
      .query({ type: 'shipping', dateTime: '2026-01-01 10:00:00', scanNo: 5, username: 'gudang2' });

    expect(res.status).toBe(200);
    expect(res.body.stockAdjustment).toBe(12);
  });
});

describe('POST /api/master-data/backup', () => {
  beforeEach(() => mockTxQuery.mockReset());

  test('400 kalau type gak valid', async () => {
    const res = await request(app)
      .post('/api/master-data/backup')
      .send({ type: 'invalid' });

    expect(res.status).toBe(400);
    expect(mockTxQuery).not.toHaveBeenCalled();
  });

  test('sukses: INSERT ke tabel backup dijalankan SEBELUM DELETE dari tabel aktif, dalam transaksi yang sama', async () => {
    mockTxQuery
      .mockResolvedValueOnce({ recordset: [] }) // INSERT ke backup_receiving
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [42] }); // DELETE dari data_receiving

    const res = await request(app)
      .post('/api/master-data/backup')
      .send({ type: 'receiving' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/42/);

    const insertCall = mockTxQuery.mock.calls[0];
    const deleteCall = mockTxQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO.*backup_receiving/is);
    expect(deleteCall[0]).toMatch(/DELETE FROM.*data_receiving/is);
  });
});
