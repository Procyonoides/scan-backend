/**
 * ========== SHARED WAREHOUSE STATS HELPER ==========
 *
 * Satu sumber kebenaran untuk Stock Monitoring, dipakai oleh:
 *  - GET /api/dashboard/warehouse-stats  (initial load / manual refresh)
 *  - receiving.routes.js  -> /scan & /batch-scan (real-time socket emit)
 *  - shipping.routes.js   -> /scan & /batch-scan (real-time socket emit)
 *
 * Supaya ketiga tempat itu SELALU pakai definisi & angka yang sama persis,
 * bukan masing-masing hitung ulang dengan query yang beda-beda.
 *
 * Definisi:
 *  - firstStock     = stok awal HARI INI (snapshot, stabil sepanjang hari).
 *                      Diambil dari tabel `stok`. Kalau belum ada record utk
 *                      hari ini, dibuat otomatis dari stock_akhir kemarin
 *                      (atau 0 kalau belum pernah ada sama sekali).
 *  - warehouseStock = SUM(stock) LIVE dari master_database. Ini kondisi
 *                      gudang saat ini, jadi selalu dihitung real-time -
 *                      bukan dari cache tabel `stok` - supaya tiap scan
 *                      langsung kelihatan perubahannya.
 *
 * Catatan migrasi dari CI3:
 *  Di CI3 (`dashboard_it`/`dashboard_server`/`dashboard_management`),
 *  "First Stock" ikut dihitung ulang dari SUM(stock) master_database tiap
 *  page load (jadi sebenarnya bukan stok "awal", tapi duplikat dari stok
 *  "saat ini"). Di sini sengaja dipisah dengan benar: firstStock = saldo
 *  awal hari (snapshot), warehouseStock = saldo saat ini (live).
 */

async function getWarehouseStats(query, dbName) {
  // 1. Hitung scan hari ini (selalu live, real-time)
  const scanResult = await query(`
    SELECT 
      ISNULL((SELECT COUNT(*) FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_count,
      ISNULL((SELECT SUM(quantity) FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_qty,
      ISNULL((SELECT COUNT(*) FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_count,
      ISNULL((SELECT SUM(quantity) FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_qty
  `);
  const scanStats = scanResult.recordset[0] || {};

  // 2. warehouseStock SELALU live dari master_database (kondisi gudang saat ini)
  const warehouseResult = await query(`
    SELECT ISNULL(SUM(stock), 0) as warehouse_stock
    FROM [${dbName}].[dbo].[master_database]
  `);
  const warehouseStock = warehouseResult.recordset[0]?.warehouse_stock || 0;

  // 3. firstStock = snapshot stok awal hari ini dari tabel `stok`
  let firstStock = 0;
  const todayResult = await query(`
    SELECT TOP 1 ISNULL(stock_awal, 0) as first_stock
    FROM [${dbName}].[dbo].[stok]
    WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)
    ORDER BY date DESC
  `);

  if (todayResult.recordset.length > 0) {
    // Sudah ada snapshot hari ini -> pakai itu, JANGAN dihitung ulang
    // (supaya stabil sepanjang hari, tidak berubah-ubah tiap scan)
    firstStock = todayResult.recordset[0].first_stock;
  } else {
    // Belum ada snapshot hari ini -> ambil stock_akhir kemarin sebagai
    // stock_awal hari ini, lalu simpan (self-healing, tidak perlu cron job)
    const yesterdayResult = await query(`
      SELECT TOP 1 ISNULL(stock_akhir, 0) as yesterday_stock
      FROM [${dbName}].[dbo].[stok]
      WHERE CAST(date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
      ORDER BY date DESC
    `);

    firstStock = yesterdayResult.recordset.length > 0
      ? yesterdayResult.recordset[0].yesterday_stock
      : warehouseStock; // hari pertama sistem jalan: pakai kondisi gudang saat ini

    // Simpan snapshot hari ini supaya besok ada "kemarin" yang valid,
    // dan supaya firstStock stabil untuk sisa hari ini (tidak dihitung ulang lagi)
    try {
      await query(`
        INSERT INTO [${dbName}].[dbo].[stok] (date, stock_awal, receiving, shipping, stock_akhir)
        VALUES (GETDATE(), @firstStock, 0, 0, @warehouseStock)
      `, { firstStock, warehouseStock });
    } catch (insertErr) {
      // Kalau gagal insert (misal race condition dua request bersamaan),
      // jangan sampai bikin request utama gagal - cukup log saja
      console.error('⚠️ Failed to create today stok snapshot:', insertErr.message);
    }
  }

  // 4. Warehouse items untuk chart (per kategori item)
  const warehouseItemsResult = await query(`
    SELECT 
      item,
      CAST(SUM(stock) * 100.0 / ISNULL(NULLIF((
        SELECT SUM(stock) FROM [${dbName}].[dbo].[master_database]
      ), 0), 1) AS DECIMAL(10, 0)) AS status,
      SUM(stock) AS total
    FROM [${dbName}].[dbo].[master_database]
    GROUP BY item
    ORDER BY total DESC
  `);

  return {
    firstStock,
    warehouseStock,
    receivingCount: scanStats.receiving_count,
    receivingQty: scanStats.receiving_qty,
    shippingCount: scanStats.shipping_count,
    shippingQty: scanStats.shipping_qty,
    warehouseItems: warehouseItemsResult.recordset
  };
}

module.exports = { getWarehouseStats };
