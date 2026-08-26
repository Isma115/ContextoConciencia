const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const { openDatabase } = require('./database/db');
const { createAuthDatabase } = require('./database/mysql');
const { createOfflineAuthDatabase } = require('./auth');
const { installRoutes } = require('./routes');

function resolveEnvironment(environment = process.env) {
  const resolved = { ...environment };
  if (!resolved.JWT_SECRET) {
    resolved.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }
  return resolved;
}

function offlineModeEnabled(value, environment) {
  if (typeof value === 'boolean') return value;
  return String(environment?.OFFLINE_ONLY ?? 'true').toLowerCase() !== 'false';
}

function createApp({ dbPath, authDb, environment = process.env, offlineOnly = null } = {}) {
  const resolvedEnvironment = resolveEnvironment(environment);
  const useOfflineOnly = offlineModeEnabled(offlineOnly, resolvedEnvironment);
  const app = express();
  const db = openDatabase(dbPath);
  const resolvedAuthDb = authDb || (useOfflineOnly ? createOfflineAuthDatabase() : createAuthDatabase(resolvedEnvironment));
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.authDb = resolvedAuthDb;
  app.locals.dbPath = db.path;
  app.locals.offlineOnly = useOfflineOnly;

  app.use(cookieParser());
  app.use(express.json({ limit: '30mb' }));
  installRoutes(app, db, resolvedAuthDb, resolvedEnvironment, { offlineOnly: useOfflineOnly });
  app.use(express.static(path.join(__dirname, '..', 'desktop'), { index: 'index.html' }));
  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

function startServer({ port = 3000, host = '127.0.0.1', dbPath, authDb, environment, offlineOnly = null } = {}) {
  const app = createApp({ dbPath, authDb, environment, offlineOnly });
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      Promise.resolve(app.locals.authDb.initialize()).then(() => resolve({
        app,
        server,
        port: typeof address === 'object' && address ? address.port : port,
        host,
        close: () => new Promise((done) => server.close(async () => { app.locals.db.close(); await app.locals.authDb.close(); done(); }))
      }));
    });
  });
}

if (require.main === module) {
  startServer({ port: Number(process.env.PORT) || 3000 })
    .then(({ port }) => console.log(`NexusData API escuchando en http://127.0.0.1:${port}/api`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { createApp, startServer };
