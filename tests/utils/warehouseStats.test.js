const { getWarehouseStats } = require('../../utils/warehouseStats');

describe('getWarehouseStats', () => {
  const dbName = 'TestDB';
  let mockQuery;

  beforeEach(() => {
    mockQuery = jest.fn();
  });

  test('pakai snapshot stock_awal yang udah ada kalau record hari ini sudah ada di tabel stok', async () => {
    // Urutan call di dalam getWarehouseStats():
    // 1. scan stats (receiving/shipping count+qty hari ini)
    // 2. warehouse stock live dari master_database
    // 3. cek record 'stok' hari ini -> DITEMUKAN, jadi tidak perlu insert baru
    // 4. warehouse items (buat chart)
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ receiving_count: 5, receiving_qty: 50, shipping_count: 2, shipping_qty: 20 }] })
      .mockResolvedValueOnce({ recordset: [{ warehouse_stock: 1000 }] })
      .mockResolvedValueOnce({ recordset: [{ first_stock: 900 }] }) // record hari ini sudah ada
      .mockResolvedValueOnce({ recordset: [{ item: 'IP', status: 60, total: 600 }] });

    const result = await getWarehouseStats(mockQuery, dbName);

    expect(result.firstStock).toBe(900);       // pakai snapshot yang sudah ada, BUKAN dihitung ulang
    expect(result.warehouseStock).toBe(1000);  // selalu live dari master_database
    expect(result.receivingCount).toBe(5);
    expect(result.shippingCount).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(4); // gak ada query INSERT tambahan
  });

  test('bikin snapshot baru dari stock_akhir kemarin kalau record hari ini belum ada', async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ receiving_count: 0, receiving_qty: 0, shipping_count: 0, shipping_qty: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ warehouse_stock: 1200 }] })
      .mockResolvedValueOnce({ recordset: [] })                       // belum ada record hari ini
      .mockResolvedValueOnce({ recordset: [{ yesterday_stock: 1150 }] }) // stock_akhir kemarin
      .mockResolvedValueOnce({ recordset: [] })                       // hasil INSERT (diabaikan)
      .mockResolvedValueOnce({ recordset: [] });                      // warehouse items

    const result = await getWarehouseStats(mockQuery, dbName);

    expect(result.firstStock).toBe(1150);      // ambil dari stock_akhir kemarin
    expect(result.warehouseStock).toBe(1200);
    expect(mockQuery).toHaveBeenCalledTimes(6); // termasuk 1x query INSERT snapshot baru

    // Pastikan query terakhir sebelum warehouse-items itu beneran INSERT ke tabel stok
    const insertCallArgs = mockQuery.mock.calls[4];
    expect(insertCallArgs[0]).toMatch(/INSERT INTO/i);
    expect(insertCallArgs[0]).toMatch(/\[stok\]/);
    expect(insertCallArgs[1]).toEqual({ firstStock: 1150, warehouseStock: 1200 });
  });

  test('pakai kondisi gudang saat ini sebagai firstStock kalau belum pernah ada history sama sekali (hari pertama sistem jalan)', async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ receiving_count: 0, receiving_qty: 0, shipping_count: 0, shipping_qty: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ warehouse_stock: 500 }] })
      .mockResolvedValueOnce({ recordset: [] }) // belum ada record hari ini
      .mockResolvedValueOnce({ recordset: [] }) // belum ada record kemarin juga
      .mockResolvedValueOnce({ recordset: [] }) // INSERT
      .mockResolvedValueOnce({ recordset: [] });

    const result = await getWarehouseStats(mockQuery, dbName);

    expect(result.firstStock).toBe(500);       // fallback ke warehouseStock saat ini
    expect(result.warehouseStock).toBe(500);
  });

  test('tetap ngembaliin hasil normal walau INSERT snapshot gagal (misal race condition)', async () => {
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ receiving_count: 1, receiving_qty: 10, shipping_count: 0, shipping_qty: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ warehouse_stock: 800 }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ yesterday_stock: 750 }] })
      .mockRejectedValueOnce(new Error('Violation of PRIMARY KEY constraint')) // INSERT gagal
      .mockResolvedValueOnce({ recordset: [] });

    const result = await getWarehouseStats(mockQuery, dbName);

    // Request utama tetap sukses walau insert snapshot-nya gagal
    expect(result.firstStock).toBe(750);
    expect(result.warehouseStock).toBe(800);
  });

  test('warehouseItems ke-passing apa adanya dari hasil query buat chart', async () => {
    const fakeItems = [
      { item: 'IP', status: 60, total: 600 },
      { item: 'TKC', status: 40, total: 400 }
    ];
    mockQuery
      .mockResolvedValueOnce({ recordset: [{ receiving_count: 0, receiving_qty: 0, shipping_count: 0, shipping_qty: 0 }] })
      .mockResolvedValueOnce({ recordset: [{ warehouse_stock: 1000 }] })
      .mockResolvedValueOnce({ recordset: [{ first_stock: 1000 }] })
      .mockResolvedValueOnce({ recordset: fakeItems });

    const result = await getWarehouseStats(mockQuery, dbName);

    expect(result.warehouseItems).toEqual(fakeItems);
  });
});
