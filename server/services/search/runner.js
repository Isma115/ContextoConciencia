const path = require('node:path');
const { Worker } = require('node:worker_threads');

const SEARCH_WORKER_PATH = path.join(__dirname, 'worker.js');

function createSearchWorker(dbPath) {
  let worker = null;
  let nextRequestId = 0;
  let closed = false;
  const pending = new Map();

  function rejectPending(error) {
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
  }

  function startWorker() {
    if (worker || closed) return worker;
    const currentWorker = new Worker(SEARCH_WORKER_PATH, { workerData: { dbPath } });
    worker = currentWorker;
    currentWorker.on('message', (message) => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === 'complete') request.resolve(message.results);
      else request.reject(new Error(message.error || 'La búsqueda no se pudo completar'));
    });
    currentWorker.on('error', (error) => {
      if (worker !== currentWorker) return;
      worker = null;
      rejectPending(error);
    });
    currentWorker.on('exit', (code) => {
      if (worker !== currentWorker) return;
      worker = null;
      if (!closed) rejectPending(new Error(`El hilo de búsqueda terminó con código ${code}`));
    });
    return currentWorker;
  }

  function search(query, filters = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('El hilo de búsqueda está cerrado'));
        return;
      }
      let currentWorker;
      try {
        currentWorker = startWorker();
      } catch (error) {
        reject(error);
        return;
      }
      const id = ++nextRequestId;
      pending.set(id, { resolve, reject });
      try {
        currentWorker.postMessage({ id, query, filters, options });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    rejectPending(new Error('El hilo de búsqueda se ha cerrado'));
    const currentWorker = worker;
    worker = null;
    if (currentWorker) await currentWorker.terminate();
  }

  return { search, close };
}

module.exports = { createSearchWorker };
