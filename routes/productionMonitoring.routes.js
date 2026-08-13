const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { query, dbName } = require('../config/database');

// No verifyToken here on purpose: this module is a read-only display
// (e.g. a floor TV screen) and is intentionally public. It never
// writes to the database and never touches the scan endpoints.

// Username -> department derivation, ported from the old CodeIgniter
// model (model_receiving.php):
//   '..._X_IN' -> strip last 5 chars
//   '..._IN'   -> strip last 3 chars
//   else       -> username itself
const DEPARTMENT_CASE = `
  CASE
    WHEN username LIKE '%\\_[A-Z]\\_IN' ESCAPE '\\' THEN LEFT(username, LEN(username) - 5)
    WHEN username LIKE '%\\_IN' ESCAPE '\\' THEN LEFT(username, LEN(username) - 3)
    ELSE username
  END
`;

// ============ WEEKLY SHIFT ROTATION ============
// Corrected per the user's spec: for IP/PHYLON/BLOKER, each group cycles
// Pagi -> Malam -> Siang -> Pagi -> ... week over week (NOT the forward
// Pagi->Siang->Malam order the old CodeIgniter code actually implemented -
// that was checked against two consecutive weeks and only matched on the
// first one). GOODSOLE/RUBBER stay fixed, no rotation.
const SHIFT_MAP = ['Pagi', 'Siang', 'Malam'];
const SHIFT_COLOR = { Pagi: 'red', Siang: 'orange', Malam: 'blue' };
const GROUP_OFFSET = { A: 0, B: 1, C: 2 };
const SPECIAL_GROUP_OFFSET = { A: 0, B: 1, C: 2 }; // fixed, no rotation
const EXCLUDED_DEPARTMENTS = ['GOODSOLE', 'RUBBER'];
const ROTATION_START = new Date('2026-01-05T00:00:00Z');

function currentWeekIndex() {
  const diffMs = Date.now() - ROTATION_START.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  return Math.floor(diffDays / 7);
}

function groupOf(username) {
  const match = /([A-C])_IN$/.exec(username || '');
  return match ? match[1] : 'A';
}

function resolveShift({ username, index, mode, isExcluded, weekIndex }) {
  if (mode === 'single') return 'Pagi';
  if (mode === 'double') return index === 0 ? 'Pagi' : 'Siang';

  const group = groupOf(username);
  if (isExcluded) {
    return SHIFT_MAP[SPECIAL_GROUP_OFFSET[group]];
  }
  // Subtracting weekIndex (instead of adding) makes the index step backward
  // by one each week: Pagi(0) -> Malam(2) -> Siang(1) -> Pagi(0) -> ...
  const normalized = ((GROUP_OFFSET[group] - weekIndex) % 3 + 3) % 3;
  return SHIFT_MAP[normalized];
}

// Builds the { Pagi: {...}, Siang: {...}, Malam: {...} } shape for one department
// from raw per-username aggregates.
function buildShiftCards(department, rows) {
  const isExcluded = EXCLUDED_DEPARTMENTS.includes(department.toUpperCase());
  const weekIndex = currentWeekIndex();
  const mode = rows.length === 1 ? 'single' : rows.length === 2 ? 'double' : 'triple';

  const data = {};
  for (const shift of SHIFT_MAP) {
    data[shift] = {
      total: 0,
      username: null,
      color: SHIFT_COLOR[shift],
      datetime_start: null,
      datetime_end: null
    };
  }

  rows.forEach((row, index) => {
    const shift = resolveShift({ username: row.username, index, mode, isExcluded, weekIndex });
    data[shift].username = row.username;
    if (row.datetime_start) {
      data[shift].total += Number(row.total_quantity) || 0;
      data[shift].datetime_start = row.datetime_start;
      data[shift].datetime_end = row.datetime_end;
    }
  });

  return data;
}

// GET /api/production-monitoring/:department/summary
// Returns Pagi/Siang/Malam cards for a department, with weekly-rotating
// shift assignment (ported from model_receiving.php). Excluded departments
// (GOODSOLE, RUBBER) use a fixed A->Pagi/B->Siang/C->Malam mapping instead.
router.get('/:department/summary', async (req, res) => {
  try {
    const { department } = req.params;
    const result = await query(`
      SELECT
        username,
        CONVERT(varchar, MIN(date_time), 120) AS datetime_start,
        CONVERT(varchar, MAX(date_time), 120) AS datetime_end,
        ISNULL(SUM(quantity), 0) AS total_quantity
      FROM [${dbName}].[dbo].[receiving]
      WHERE production = 'PT HSK REMBANG'
        AND ${DEPARTMENT_CASE} = @department
      GROUP BY username
      ORDER BY username
    `, { department });

    const cards = buildShiftCards(department, result.recordset);
    res.json({ success: true, department, data: cards });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch production monitoring summary', message: err.message });
  }
});

// GET /api/production-monitoring/:department/details?search=&page=&limit=
// Paginated scan detail table for a department (all-time, matching the old system).
router.get('/:department/details', async (req, res) => {
  try {
    const { department } = req.params;
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const searchClause = search ? `
      AND (
        CONVERT(varchar, date_time, 120) LIKE @search OR
        original_barcode LIKE @search OR
        brand LIKE @search OR
        model LIKE @search OR
        color LIKE @search OR
        username LIKE @search OR
        description LIKE @search
      )
    ` : '';
    const params = { department, ...(search ? { search: `%${search}%` } : {}) };

    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM [${dbName}].[dbo].[receiving]
      WHERE production = 'PT HSK REMBANG'
        AND ${DEPARTMENT_CASE} = @department
        ${searchClause}
    `, params);
    const total = countResult.recordset[0].total;

    const result = await query(`
      SELECT
        CONVERT(varchar, date_time, 120) AS date_time,
        original_barcode, brand, model, color, size, quantity,
        username, description, scan_no
      FROM [${dbName}].[dbo].[receiving]
      WHERE production = 'PT HSK REMBANG'
        AND ${DEPARTMENT_CASE} = @department
        ${searchClause}
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { ...params, offset, limit });

    res.json({
      success: true,
      data: result.recordset,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch production monitoring details', message: err.message });
  }
});

// ============ SHIFT EXCEL EXPORT (ported from model_receiving::get_receiving_size_by_username
// and views/excel_department_shift.php) ============
const SHOE_SIZES = [
  '10K', '10TK', '11K', '11TK', '12K', '12TK', '13K', '13TK',
  '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T', '6', '6T',
  '7', '7T', '8', '8T', '9', '9T', '10', '10T', '11', '11T', '12', '12T',
  '13', '13T', '14', '14T', '15', '15T', '16', '16T', '17', '17T', '18', '18T'
];

// GET /api/production-monitoring/:department/print-shift?shift=Pagi&username=PHYLON_C_IN
// Downloads an .xlsx: rows grouped by model+color, one column per shoe size, plus total.
router.get('/:department/print-shift', async (req, res) => {
  try {
    const { department } = req.params;
    const shift = (req.query.shift || '').toString();
    const username = (req.query.username || '').toString();

    if (!username) {
      return res.status(400).json({ success: false, error: 'username is required' });
    }

    const result = await query(`
      SELECT model, color, size, quantity, description
      FROM [${dbName}].[dbo].[receiving]
      WHERE production = 'PT HSK REMBANG' AND username = @username
      ORDER BY date_time ASC
    `, { username });

    const grouped = new Map();
    for (const row of result.recordset) {
      const key = `${row.model}|${row.color}`;
      if (!grouped.has(key)) {
        grouped.set(key, { model: row.model, color: row.color, description: row.description, sizes: {}, total: 0 });
      }
      const entry = grouped.get(key);
      entry.sizes[row.size] = (entry.sizes[row.size] || 0) + Number(row.quantity || 0);
      entry.total += Number(row.quantity || 0);
    }

    const header = ['MODEL', 'COLOR', 'DESCRIPTION', ...SHOE_SIZES, 'TOTAL'];
    const rows = [header];
    for (const entry of grouped.values()) {
      rows.push([
        entry.model,
        entry.color,
        entry.description,
        ...SHOE_SIZES.map(size => entry.sizes[size] || ''),
        entry.total
      ]);
    }
    if (grouped.size === 0) {
      rows.push(['No Data Available']);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [`SUMMARY SHIFT DEPARTMENT ${department.toUpperCase()} SHIFT ${shift.toUpperCase()}`],
      [`DATE: ${new Date().toLocaleDateString('id-ID')}`],
      [],
      ...rows
    ]);
    ws['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 18 }, ...SHOE_SIZES.map(() => ({ wch: 6 })), { wch: 10 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Shift Summary');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileDate = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileDate}_Shift_${department.toUpperCase()}_${shift}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to generate shift export', message: err.message });
  }
});

module.exports = router;