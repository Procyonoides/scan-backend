/**
 * Normalisasi nama kolom Excel, toleran ke berbagai gaya penulisan header.
 *
 * Kenapa ada ini: waktu import barcode, staff sering bikin file Excel sendiri
 * dengan header yang MIRIP tapi gak identik sama yang backend harapkan, misal:
 *   "original barcode" (spasi, bukan underscore)
 *   "label size"        (bukan "size")
 *   "four digit"        (spasi)
 *   "model code"        (spasi)
 * Tanpa ini, sheet_to_json() bikin key persis sesuai teks header (case &
 * spasi-sensitive), jadi row.original_barcode / row.size dll selalu
 * undefined dan SEMUA baris keanggap "Missing required fields" walau
 * datanya lengkap.
 *
 * Dipakai oleh: routes/masterData.routes.js (POST /import-barcode)
 */

const HEADER_ALIASES = {
  originalbarcode: 'original_barcode',
  barcode: 'original_barcode',
  kodebarcode: 'original_barcode',
  brand: 'brand',
  merek: 'brand',
  color: 'color',
  colour: 'color',
  warna: 'color',
  size: 'size',
  labelsize: 'size',
  ukuran: 'size',
  fourdigit: 'four_digit',
  unit: 'unit',
  satuan: 'unit',
  quantity: 'quantity',
  qty: 'quantity',
  jumlah: 'quantity',
  production: 'production',
  produksi: 'production',
  model: 'model',
  modelcode: 'model_code',
  kodemodel: 'model_code',
  item: 'item',
  user: 'username',
  username: 'username',
  stock: 'stock',
  stok: 'stock'
};

/** "Label Size", "label_size", "LABEL-SIZE" semua jadi "labelsize" */
function normalizeHeader(header) {
  return header.toString().trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

/** Header mentah dari Excel -> nama field kanonik yang dipakai backend */
function resolveFieldName(header) {
  const cleanKey = normalizeHeader(header);
  return HEADER_ALIASES[cleanKey] || cleanKey;
}

/**
 * rawData: hasil XLSX.utils.sheet_to_json() (array of object, key = header asli)
 * return: array baru, tiap object key-nya sudah dinormalisasi
 */
function normalizeImportRows(rawData) {
  return rawData.map(row => {
    const normalized = {};
    for (const key of Object.keys(row)) {
      normalized[resolveFieldName(key)] = row[key];
    }
    return normalized;
  });
}

module.exports = { HEADER_ALIASES, normalizeHeader, resolveFieldName, normalizeImportRows };
