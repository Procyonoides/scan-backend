// fs di-mock total supaya test gak pernah bikin/hapus file di folder logs/ beneran
jest.mock('fs');

const fs = require('fs');

// Modul ini ngecek fs.existsSync(LOG_DIR) pas di-require (buat auto-bikin folder logs/).
// Default automock fs.existsSync() balikin undefined (falsy) -> trigger mkdirSync,
// yang juga otomatis ke-mock jadi no-op. Aman.
const { writeLog, auditActAs, readLogs, pruneOldLogs } = require('../../utils/actAsLogger');

describe('auditActAs middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeReq(overrides = {}) {
    return {
      method: 'POST',
      originalUrl: '/api/master-data/barcodes',
      user: { actingAs: true, realUsername: 'itstaff', realPosition: 'IT', username: 'gudang1', position: 'RECEIVING' },
      ...overrides
    };
  }

  test('nge-log kalau user lagi "act as" dan request-nya state-changing (POST)', () => {
    const next = jest.fn();
    auditActAs(makeReq(), {}, next);

    expect(fs.appendFile).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('GAK nge-log kalau method-nya GET (bukan state-changing), walau lagi act-as', () => {
    const next = jest.fn();
    auditActAs(makeReq({ method: 'GET' }), {}, next);

    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('GAK nge-log kalau user login normal (bukan act-as)', () => {
    const next = jest.fn();
    auditActAs(makeReq({ user: { actingAs: false } }), {}, next);

    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('tetap manggil next() walau req.user undefined (belum login)', () => {
    const next = jest.fn();
    auditActAs(makeReq({ user: undefined }), {}, next);

    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('isi log yang ditulis mengandung info user asli & user yang di-"act as"-kan', () => {
    auditActAs(makeReq(), {}, jest.fn());

    const loggedLine = fs.appendFile.mock.calls[0][1];
    const parsed = JSON.parse(loggedLine.trim());

    expect(parsed.realUser).toBe('itstaff');
    expect(parsed.actingAsUser).toBe('gudang1');
    expect(parsed.method).toBe('POST');
  });
});

describe('readLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('balikin array kosong kalau folder logs belum ada', () => {
    fs.existsSync.mockReturnValue(false);

    const result = readLogs();

    expect(result).toEqual([]);
  });

  test('gabungin entry dari beberapa file log, urut dari yang paling baru', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['act-as-2026-01-01.log', 'act-as-2026-01-02.log', 'readme.txt']);
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('2026-01-01')) {
        return JSON.stringify({ event: 'ACTION', timestamp: '2026-01-01T10:00:00.000Z' }) + '\n';
      }
      if (filePath.includes('2026-01-02')) {
        return JSON.stringify({ event: 'ACTION', timestamp: '2026-01-02T10:00:00.000Z' }) + '\n';
      }
      return '';
    });

    const result = readLogs();

    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe('2026-01-02T10:00:00.000Z'); // paling baru duluan
    expect(result[1].timestamp).toBe('2026-01-01T10:00:00.000Z');
  });

  test('file non act-as-*.log diabaikan (readme.txt dll)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['readme.txt', 'notes.md']);
    fs.readFileSync.mockReturnValue('');

    const result = readLogs();

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('filter by { from, to } cuma ambil file dalam rentang tanggal', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['act-as-2026-01-01.log', 'act-as-2026-06-15.log']);
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('2026-01-01')) return JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z' }) + '\n';
      return JSON.stringify({ timestamp: '2026-06-15T00:00:00.000Z' }) + '\n';
    });

    const result = readLogs({ from: '2026-06-01', to: '2026-06-30' });

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe('2026-06-15T00:00:00.000Z');
  });

  test('baris log yang corrupt/gak valid JSON di-skip, gak bikin crash', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['act-as-2026-01-01.log']);
    fs.readFileSync.mockReturnValue('{"valid": true, "timestamp": "2026-01-01T00:00:00.000Z"}\nBUKAN JSON YANG VALID\n');

    const result = readLogs();

    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
  });
});

describe('pruneOldLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hapus file log yang lebih tua dari 90 hari, biarin yang baru', () => {
    fs.existsSync.mockReturnValue(true);

    const veryOldDate = new Date();
    veryOldDate.setDate(veryOldDate.getDate() - 200); // jauh lebih tua dari retention 90 hari
    const oldFileName = `act-as-${veryOldDate.toISOString().slice(0, 10)}.log`;

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1); // kemarin, masih dalam retention
    const recentFileName = `act-as-${recentDate.toISOString().slice(0, 10)}.log`;

    fs.readdirSync.mockReturnValue([oldFileName, recentFileName]);

    pruneOldLogs();

    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.unlink.mock.calls[0][0]).toContain(oldFileName);
  });

  test('gak ngapa-ngapain kalau folder logs belum ada', () => {
    fs.existsSync.mockReturnValue(false);

    pruneOldLogs();

    expect(fs.readdirSync).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });
});
