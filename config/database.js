require('dotenv').config();
const sql = require('mssql');

const config = {
  server: 'localhost',
  port: 58358,
  database: process.env.DB_NAME,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    }
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 60000,
    requestTimeout: 60000
  }
};

let pool = null;

async function connectDB() {
  try {
    pool = new sql.ConnectionPool(config);
    pool.on('error', err => {
      console.error('SQL pool error:', err);
      // Attempt reconnect after 5 seconds
      setTimeout(connectDB, 5000);
    });
    await pool.connect();
    console.log('✅ Connected to SQL Server (Port: 58358)');
    return pool;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('Retrying in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
}

async function query(sql, params = {}) {
  try {
    if (!pool || !pool.connected) {
      throw new Error('Database pool not connected');
    }
    const request = pool.request();
    
    for (const key in params) {
      request.input(key, params[key]);
    }
    
    return await request.query(sql);
  } catch (err) {
    console.error('Query error:', err.message);
    throw err;
  }
}

module.exports = { connectDB, pool, query };