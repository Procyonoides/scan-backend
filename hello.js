require('dotenv').config();
const sql = require('mssql');

const config = {
  server: 'localhost',
  port: 58358,
  database: process.env.DB_DATABASE,
  authentication: {
    type: 'default',
    options: {
      userName: process.env.DB_USER || 'sa',
      password: process.env.DB_PASSWORD
    }
  },
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 60000
  }
};

async function checkSchema() {
  try {
    const pool = await sql.connect(config);
    console.log('✅ Connected to database!\n');
    
    // Get all columns in users table
    const columnsResult = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'users'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('📋 Columns in dbo.users table:');
    console.log('═'.repeat(60));
    columnsResult.recordset.forEach(col => {
      const nullable = col.IS_NULLABLE === 'YES' ? '(nullable)' : '(required)';
      console.log(`  ${col.ORDINAL_POSITION}. ${col.COLUMN_NAME.padEnd(25)} ${col.DATA_TYPE.padEnd(15)} ${nullable}`);
    });
    
    console.log('\n📊 Sample data (first 5 rows):');
    console.log('═'.repeat(60));
    const sampleData = await pool.request().query(`
      SELECT TOP 5 * FROM dbo.users
    `);
    
    if (sampleData.recordset.length > 0) {
      console.log(JSON.stringify(sampleData.recordset, null, 2));
    } else {
      console.log('(No data)');
    }
    
    console.log('\n✅ Check completed!');
    await pool.close();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkSchema();