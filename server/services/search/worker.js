const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { searchDocuments } = require('./index');

const database = new DatabaseSync(workerData.dbPath, { readOnly: true });
const db = {
  all(sql, ...params) {
    return database.prepare(sql).all(...params);
  },
  get(sql, ...params) {
    return database.prepare(sql).get(...params);
  }
};

parentPort.on('message', ({ id, query, filters, options }) => {
  try {
    const results = searchDocuments(db, query, filters, options);
    parentPort.postMessage({ id, type: 'complete', results });
  } catch (error) {
    parentPort.postMessage({ id, type: 'error', error: error.message });
  }
});
