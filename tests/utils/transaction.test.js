const mockBegin = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockInput = jest.fn();
const mockRequestQuery = jest.fn();

jest.mock('mssql', () => ({
  Transaction: jest.fn().mockImplementation(() => ({
    begin: mockBegin,
    commit: mockCommit,
    rollback: mockRollback
  })),
  Request: jest.fn().mockImplementation(() => ({
    input: mockInput,
    query: mockRequestQuery
  }))
}));

jest.mock('../../config/database', () => ({
  getPool: jest.fn()
}));

const { getPool } = require('../../config/database');
const { runInTransaction } = require('../../utils/transaction');

describe('runInTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockReturnValue({ connected: true });
    mockBegin.mockResolvedValue();
    mockCommit.mockResolvedValue();
    mockRollback.mockResolvedValue();
  });

  test('error kalau pool belum connect', async () => {
    getPool.mockReturnValue(null);

    await expect(runInTransaction(async () => {})).rejects.toThrow('Database pool not connected');
  });

  test('commit dipanggil kalau callback sukses, dan return value-nya diteruskan', async () => {
    const result = await runInTransaction(async (txQuery) => {
      return 'hasil dari callback';
    });

    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockRollback).not.toHaveBeenCalled();
    expect(result).toBe('hasil dari callback');
  });

  test('rollback dipanggil kalau callback throw error, dan error-nya diteruskan ke pemanggil', async () => {
    await expect(
      runInTransaction(async () => {
        throw new Error('Gagal di tengah jalan');
      })
    ).rejects.toThrow('Gagal di tengah jalan');

    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  test('tetap throw error asli walau rollback-nya sendiri juga gagal', async () => {
    mockRollback.mockRejectedValueOnce(new Error('Rollback gagal juga'));

    await expect(
      runInTransaction(async () => {
        throw new Error('Error asli');
      })
    ).rejects.toThrow('Error asli'); // bukan "Rollback gagal juga"
  });

  test('txQuery yang dikasih ke callback nge-set parameter dengan benar', async () => {
    mockRequestQuery.mockResolvedValueOnce({ recordset: [] });

    await runInTransaction(async (txQuery) => {
      await txQuery('SELECT * FROM foo WHERE id = @id', { id: 5 });
    });

    expect(mockInput).toHaveBeenCalledWith('id', 5);
    expect(mockRequestQuery).toHaveBeenCalledWith('SELECT * FROM foo WHERE id = @id');
  });
});
