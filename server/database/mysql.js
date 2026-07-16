const mysql = require('mysql2/promise');

const USER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

function mysqlConfig(environment = process.env) {
  return {
    host: environment.MYSQL_HOST || '127.0.0.1',
    port: Number(environment.MYSQL_PORT) || 3306,
    database: environment.MYSQL_DATABASE || 'nexusdata_auth',
    user: environment.MYSQL_USER || 'nexusdata_app',
    password: environment.MYSQL_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 3000,
    timezone: 'Z'
  };
}

function createAuthDatabase(environment = process.env) {
  const pool = mysql.createPool(mysqlConfig(environment));
  let available = false;
  let lastError = null;

  return {
    async initialize() {
      try {
        await pool.query(USER_SCHEMA);
        available = true;
        lastError = null;
        return true;
      } catch (error) {
        available = false;
        lastError = error;
        return false;
      }
    },
    isAvailable: () => available,
    async ensureAvailable() {
      return available || this.initialize();
    },
    get lastError() { return lastError; },
    async findUserByUsername(username) {
      const [rows] = await pool.execute(
        'SELECT id, usuario, password_hash, creado_en FROM usuarios WHERE usuario = ? LIMIT 1',
        [username]
      );
      return rows[0] || null;
    },
    async createUser(username, passwordHash) {
      await pool.execute('INSERT INTO usuarios (usuario, password_hash) VALUES (?, ?)', [username, passwordHash]);
      return this.findUserByUsername(username);
    },
    async close() {
      await pool.end();
    }
  };
}

module.exports = { createAuthDatabase, mysqlConfig, USER_SCHEMA };
