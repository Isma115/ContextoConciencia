const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { PriceStore, cleanText } = require('./store');
const { searchWithSerpApi } = require('./providers/serpapi');

let mainWindow;
let store;
let activeSearch = false;

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f5f7fb',
    title: 'Precio Claro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsvCatalog(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error('El CSV debe incluir una cabecera y al menos un producto.');
  }
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headings = parseCsvLine(lines[0], delimiter).map((heading) => heading.toLocaleLowerCase('es').trim());
  const nameIndex = headings.findIndex((heading) => ['nombre', 'name', 'producto', 'product'].includes(heading));
  const queryIndex = headings.findIndex((heading) => ['consulta', 'query', 'búsqueda', 'busqueda', 'search'].includes(heading));
  const categoryIndex = headings.findIndex((heading) => ['categoría', 'categoria', 'category'].includes(heading));

  if (nameIndex === -1) {
    throw new Error('No se encontró una columna "nombre" (también se acepta name o producto).');
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return {
      name: values[nameIndex] || '',
      query: queryIndex === -1 ? '' : values[queryIndex] || '',
      category: categoryIndex === -1 ? '' : values[categoryIndex] || ''
    };
  });
}

function broadcastProgress(progress) {
  mainWindow?.webContents.send('catalog:search-progress', progress);
}

async function searchOneProduct(productId, index, total) {
  const state = store.getPublicState();
  const product = state.products.find((item) => item.id === productId);
  if (!product) throw new Error('El producto ya no existe.');

  broadcastProgress({ productId, index, total, status: 'searching', name: product.name });
  try {
    const apiKey = await store.getApiKey();
    const offers = await searchWithSerpApi({
      query: product.query,
      settings: state.settings,
      apiKey
    });
    await store.recordSearch(product.id, offers);
    broadcastProgress({ productId, index, total, status: 'done', name: product.name, offers: offers.length });
    return { productId, offers: offers.length };
  } catch (error) {
    await store.recordSearchError(product.id, error.message);
    broadcastProgress({ productId, index, total, status: 'error', name: product.name, error: error.message });
    throw error;
  }
}

async function runSearches(productIds) {
  if (activeSearch) throw new Error('Ya hay una actualización del catálogo en curso.');
  if (!productIds.length) throw new Error('Añade al menos un producto antes de buscar ofertas.');
  if (!store.hasApiKey()) {
    throw new Error('Configura una clave de SerpApi en Ajustes antes de buscar ofertas reales.');
  }

  activeSearch = true;
  const results = [];
  const failures = [];
  const total = productIds.length;
  let cursor = 0;
  const concurrency = Math.min(2, total);

  try {
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < total) {
        const index = cursor;
        cursor += 1;
        try {
          results.push(await searchOneProduct(productIds[index], index + 1, total));
        } catch (error) {
          failures.push({ productId: productIds[index], message: error.message });
        }
      }
    });
    await Promise.all(workers);
    return {
      completed: results.length,
      failed: failures.length,
      failures,
      state: store.getPublicState()
    };
  } finally {
    activeSearch = false;
  }
}

function setupIpc() {
  ipcMain.handle('catalog:get-state', () => store.getPublicState());

  ipcMain.handle('catalog:add-product', async (_event, input) => {
    await store.addProduct(input);
    return store.getPublicState();
  });

  ipcMain.handle('catalog:delete-product', async (_event, productId) => {
    if (typeof productId !== 'string') throw new Error('El identificador de producto no es válido.');
    return store.deleteProduct(productId);
  });

  ipcMain.handle('catalog:update-settings', async (_event, input) => store.updateSettings(input));

  ipcMain.handle('catalog:search-one', async (_event, productId) => {
    if (typeof productId !== 'string') throw new Error('El identificador de producto no es válido.');
    const response = await runSearches([productId]);
    if (response.failed) throw new Error(response.failures[0]?.message || 'La búsqueda no se ha podido completar.');
    return response.state;
  });

  ipcMain.handle('catalog:search-all', async () => {
    const response = await runSearches(store.getPublicState().products.map((product) => product.id));
    return response;
  });

  ipcMain.handle('catalog:import-csv', async () => {
    const response = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar catálogo CSV',
      properties: ['openFile'],
      filters: [{ name: 'Catálogo CSV', extensions: ['csv'] }]
    });
    if (response.canceled || !response.filePaths[0]) return { canceled: true };
    const content = await fs.readFile(response.filePaths[0], 'utf8');
    const result = await store.importProducts(parseCsvCatalog(content));
    return { canceled: false, ...result };
  });

  ipcMain.handle('catalog:open-offer', async (_event, url) => {
    if (!isSafeExternalUrl(url)) throw new Error('La dirección de la oferta no es válida.');
    await shell.openExternal(url);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  try {
    store = new PriceStore({
      filePath: path.join(app.getPath('userData'), 'precio-claro', 'catalogo.json'),
      environmentKey: process.env.PRECIO_CLARO_SERPAPI_KEY
    });
    await store.initialize();
    setupIpc();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Precio Claro no ha podido iniciarse', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
