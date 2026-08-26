const { parentPort } = require('node:worker_threads');
const { analyzeCodeMap } = require('./index');

if (parentPort) {
  parentPort.on('message', ({ root, options }) => {
    try {
      parentPort.postMessage({ type: 'complete', result: analyzeCodeMap(root, options) });
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error.message });
    }
  });
}
