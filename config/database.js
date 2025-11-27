const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    }
  },
  options: {
    encrypt: true,
    trustServerCertificate: true,
    connectTimeout: 30000
  }
};

let pool = null;

async function connectDB() {
  try {
    pool = new sql.ConnectionPool(config);
    pool.on('error', err => {
      console.error('SQL pool error:', err);
    });
    await pool.connect();
    console.log('Connected to SQL Server');
  } catch (err) {
    console.error('Database connection failed:', err);
    setTimeout(connectDB, 5000);
  }
}

async function query(sql, params = {}) {
  const request = pool.request();
  for (const key in params) {
    request.input(key, params[key]);
  }
  return await request.query(sql);
}

module.exports = { connectDB, pool, query };