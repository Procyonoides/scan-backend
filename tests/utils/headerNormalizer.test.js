const {
  normalizeHeader,
  resolveFieldName,
  normalizeImportRows
} = require('../../utils/headerNormalizer');

describe('normalizeHeader', () => {
  test('lowercase-in header tetap sama', () => {
    expect(normalizeHeader('brand')).toBe('brand');
  });

  test('spasi dihilangkan', () => {
    expect(normalizeHeader('original barcode')).toBe('originalbarcode');
  });

  test('underscore dihilangkan', () => {
    expect(normalizeHeader('original_barcode')).toBe('originalbarcode');
  });

  test('UPPERCASE ke-lowercase-in', () => {
    expect(normalizeHeader('ORIGINAL_BARCODE')).toBe('originalbarcode');
  });

  test('strip (dash) dihilangkan', () => {
    expect(normalizeHeader('model-code')).toBe('modelcode');
  });

  test('spasi berlebih di pinggir di-trim', () => {
    expect(normalizeHeader('  size  ')).toBe('size');
  });
});

describe('resolveFieldName', () => {
  test('header persis sama dengan field kanonik', () => {
    expect(resolveFieldName('brand')).toBe('brand');
  });

  test('"label size" -> size (kasus asli yang bikin bug kemarin)', () => {
    expect(resolveFieldName('label size')).toBe('size');
  });

  test('"original barcode" -> original_barcode', () => {
    expect(resolveFieldName('original barcode')).toBe('original_barcode');
  });

  test('"four digit" -> four_digit', () => {
    expect(resolveFieldName('four digit')).toBe('four_digit');
  });

  test('"model code" -> model_code', () => {
    expect(resolveFieldName('model code')).toBe('model_code');
  });

  test('alias bahasa Indonesia: "warna" -> color', () => {
    expect(resolveFieldName('warna')).toBe('color');
  });

  test('alias bahasa Indonesia: "jumlah" -> quantity', () => {
    expect(resolveFieldName('jumlah')).toBe('quantity');
  });

  test('header yang gak dikenal dikembalikan apa adanya (dinormalisasi)', () => {
    expect(resolveFieldName('Catatan Tambahan')).toBe('catatantambahan');
  });
});

describe('normalizeImportRows', () => {
  test('normalisasi satu baris penuh dengan header UPPERCASE (template resmi lama)', () => {
    const rawData = [{
      ORIGINAL_BARCODE: 'ABC123',
      BRAND: 'NEW BALANCE',
      COLOR: 'BLACK',
      SIZE: '10',
      FOUR_DIGIT: '0036',
      UNIT: 'PRS',
      QUANTITY: '12',
      PRODUCTION: 'PT HSK REMBANG',
      MODEL: 'BOOST',
      MODEL_CODE: 'BST',
      ITEM: 'IP'
    }];

    const result = normalizeImportRows(rawData);

    expect(result[0]).toEqual({
      original_barcode: 'ABC123',
      brand: 'NEW BALANCE',
      color: 'BLACK',
      size: '10',
      four_digit: '0036',
      unit: 'PRS',
      quantity: '12',
      production: 'PT HSK REMBANG',
      model: 'BOOST',
      model_code: 'BST',
      item: 'IP'
    });
  });

  test('normalisasi file custom staff (kasus asli dari bug report)', () => {
    const rawData = [{
      'original barcode': 'HRTKCTRC003T',
      'brand': 'NEW BALANCE',
      'color': 'TEAM ROYAL COLORO',
      'label size': '3T',
      'four digit': '003T',
      'unit': 'PRS',
      'quantity': '12',
      'production': 'PT HSK REMBANG',
      'model': 'BLOKER TEKCOC V3 GS R',
      'model code': 'TKC',
      'item': 'BLOKER'
    }];

    const result = normalizeImportRows(rawData);

    expect(result[0].original_barcode).toBe('HRTKCTRC003T');
    expect(result[0].size).toBe('3T');
    expect(result[0].four_digit).toBe('003T'); // leading zero tetap kejaga (string, bukan number)
    expect(result[0].model_code).toBe('TKC');
  });

  test('banyak baris sekaligus tetap konsisten', () => {
    const rawData = [
      { 'original barcode': 'A1', 'label size': '8' },
      { 'original barcode': 'A2', 'label size': '9' }
    ];

    const result = normalizeImportRows(rawData);

    expect(result).toHaveLength(2);
    expect(result[0].size).toBe('8');
    expect(result[1].size).toBe('9');
  });

  test('array kosong menghasilkan array kosong', () => {
    expect(normalizeImportRows([])).toEqual([]);
  });
});
