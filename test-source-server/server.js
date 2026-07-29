const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DOCUMENTS_DIR = path.join(__dirname, 'documents');

function markdownTitle(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

async function markdownDocuments() {
  const entries = await fs.readdir(DOCUMENTS_DIR, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(filenames.map(async (filename) => {
    const content = await fs.readFile(path.join(DOCUMENTS_DIR, filename), 'utf8');
    return {
      id: filename,
      title: markdownTitle(content, path.parse(filename).name),
      description: content,
      filename
    };
  }));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body, null, 2));
}

function createTestSourceServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'NexusData test source' });
      }

      if (req.method === 'GET' && url.pathname === '/documents') {
        const documents = await markdownDocuments();
        return sendJson(res, 200, { data: documents });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/documents/')) {
        const requestedName = decodeURIComponent(url.pathname.slice('/documents/'.length));
        if (requestedName !== path.basename(requestedName) || !/\.md$/i.test(requestedName)) {
          return sendJson(res, 400, { error: 'Nombre de documento no válido' });
        }

        const content = await fs.readFile(path.join(DOCUMENTS_DIR, requestedName), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        return res.end(content);
      }

      return sendJson(res, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Documento no encontrado' });
      console.error(error);
      return sendJson(res, 500, { error: 'Error interno del servidor' });
    }
  });
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function startTestSourceServer({
  port = Number(process.env.TEST_SOURCE_PORT) || 4100,
  host = process.env.TEST_SOURCE_HOST || '0.0.0.0'
} = {}) {
  const server = createTestSourceServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({ server, host, port: typeof address === 'object' ? address.port : port });
    });
  });
}

if (require.main === module) {
  startTestSourceServer()
    .then(({ port }) => {
      console.log(`Fuente de prueba disponible en http://127.0.0.1:${port}/documents`);
      for (const address of localAddresses()) {
        console.log(`Acceso desde la red local: http://${address}:${port}/documents`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { createTestSourceServer, startTestSourceServer };
