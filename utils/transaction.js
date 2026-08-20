const sql = require('mssql');
const { getPool } = require('../config/database');

/**
 * Jalanin beberapa query SQL sebagai SATU transaksi atomik: kalau ada satu
 * query yang gagal di tengah jalan, SEMUA perubahan di-rollback (gak ada
 * yang "nyangkut setengah jalan").
 *
 * Dipakai buat operasi yang harus "semua berhasil atau semua batal", misal:
 *  - edit/hapus record scan SEKALIGUS sinkronin stock di master_database
 *  - backup (insert ke tabel arsip + delete dari tabel aktif)
 *
 * @param {(txQuery: (sqlText: string, params?: object) => Promise<any>) => Promise<any>} callback
 *   Terima fungsi txQuery(sqlText, params) yang jalan DI DALAM transaksi ini.
 *   Return value callback diteruskan jadi return value runInTransaction().
 */
async function runInTransaction(callback) {
  const pool = getPool();
  if (!pool || !pool.connected) {
    throw new Error('Database pool not connected');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  const txQuery = async (sqlText, params = {}) => {
    const request = new sql.Request(transaction);
    for (const key in params) {
      request.input(key, params[key]);
    }
    return request.query(sqlText);
  };

  try {
    const result = await callback(txQuery);
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (rollbackErr) {
      console.error('⚠️ Rollback failed:', rollbackErr.message);
    }
    throw err;
  }
}

module.exports = { runInTransaction };
