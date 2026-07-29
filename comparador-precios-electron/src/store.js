const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeStorage } = require('electron');

const MAX_PRODUCTS = 250;
const MAX_OFFERS_PER_PRODUCT = 40;

const DEFAULT_SETTINGS = Object.freeze({
  provider: 'serpapi',
  country: 'ES',
  language: 'es',
  currency: 'EUR'
});

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function toIsoDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSettings(value = {}) {
  const country = cleanText(value.country, 2).toUpperCase();
  const language = cleanText(value.language, 5).toLowerCase();
  const currency = cleanText(value.currency, 3).toUpperCase();

  return {
    provider: 'serpapi',
    country: /^[A-Z]{2}$/.test(country) ? country : DEFAULT_SETTINGS.country,
    language: /^[a-z]{2,5}$/.test(language) ? language : DEFAULT_SETTINGS.language,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_SETTINGS.currency
  };
}

function normalizeOffer(value) {
  const price = Number(value.price);
  const totalPrice = Number(value.totalPrice);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(totalPrice) || totalPrice < 0) {
    return null;
  }

  const url = cleanText(value.url, 2000);
  if (!/^https?:\/\//i.test(url)) return null;

  return {
    id: cleanText(value.id, 300) || randomUUID(),
    title: cleanText(value.title, 300) || 'Oferta sin título',
    source: cleanText(value.source, 120) || 'Tienda no identificada',
    url,
    price,
    totalPrice,
    currency: cleanText(value.currency, 3).toUpperCase() || DEFAULT_SETTINGS.currency,
    priceLabel: cleanText(value.priceLabel, 80),
    shippingLabel: cleanText(value.shippingLabel, 120),
    shippingPrice: Number.isFinite(Number(value.shippingPrice)) ? Number(value.shippingPrice) : null,
    shippingKnown: Boolean(value.shippingKnown),
    thumbnail: /^https?:\/\//i.test(cleanText(value.thumbnail, 2000)) ? cleanText(value.thumbnail, 2000) : '',
    rating: Number.isFinite(Number(value.rating)) ? Number(value.rating) : null,
    reviews: Number.isFinite(Number(value.reviews)) ? Number(value.reviews) : null,
    provider: cleanText(value.provider, 40) || 'serpapi',
    foundAt: toIsoDate(value.foundAt) || new Date().toISOString()
  };
}

function normalizeProduct(value) {
  const name = cleanText(value.name, 140);
  if (name.length < 2) return null;

  const query = cleanText(value.query, 200) || name;
  const offers = Array.isArray(value.offers)
    ? value.offers.map(normalizeOffer).filter(Boolean).slice(0, MAX_OFFERS_PER_PRODUCT)
    : [];

  return {
    id: cleanText(value.id, 100) || randomUUID(),
    name,
    query,
    category: cleanText(value.category, 80),
    createdAt: toIsoDate(value.createdAt) || new Date().toISOString(),
    lastSearchAt: toIsoDate(value.lastSearchAt),
    lastSearchError: cleanText(value.lastSearchError, 500),
    offers
  };
}

class PriceStore {
  constructor({ filePath, environmentKey }) {
    this.filePath = filePath;
    this.environmentKey = environmentKey;
    this.data = null;
    this.saveQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = this.normalizeData(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`No se ha podido leer el catálogo local: ${error.message}`);
      }
      this.data = this.emptyData();
      await this.save();
    }
  }

  emptyData() {
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      encryptedApiKey: '',
      products: []
    };
  }

  normalizeData(value) {
    const products = Array.isArray(value?.products)
      ? value.products.map(normalizeProduct).filter(Boolean).slice(0, MAX_PRODUCTS)
      : [];

    return {
      version: 1,
      settings: normalizeSettings(value?.settings),
      encryptedApiKey: typeof value?.encryptedApiKey === 'string' ? value.encryptedApiKey : '',
      products
    };
  }

  hasStoredApiKey() {
    return Boolean(this.data.encryptedApiKey && safeStorage.isEncryptionAvailable());
  }

  hasApiKey() {
    return Boolean(cleanText(this.environmentKey, 500) || this.hasStoredApiKey());
  }

  getPublicState() {
    return {
      settings: {
        ...this.data.settings,
        apiKeyConfigured: this.hasApiKey(),
        apiKeyFromEnvironment: Boolean(cleanText(this.environmentKey, 500)),
        keyStorageAvailable: safeStorage.isEncryptionAvailable()
      },
      products: this.data.products.map((product) => ({
        ...product,
        offers: product.offers.map((offer) => ({ ...offer }))
      }))
    };
  }

  async getApiKey() {
    const environmentKey = cleanText(this.environmentKey, 500);
    if (environmentKey) return environmentKey;
    if (!this.data.encryptedApiKey) return '';

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('El llavero del sistema no está disponible. Define PRECIO_CLARO_SERPAPI_KEY para usar el buscador.');
    }

    try {
      return safeStorage.decryptString(Buffer.from(this.data.encryptedApiKey, 'base64'));
    } catch {
      throw new Error('No se ha podido descifrar la clave de búsqueda guardada. Guarda una nueva clave en Ajustes.');
    }
  }

  async updateSettings(input = {}) {
    this.data.settings = normalizeSettings(input);

    if (input.clearApiKey === true) {
      this.data.encryptedApiKey = '';
    }

    const submittedKey = cleanText(input.apiKey, 500);
    if (submittedKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('El llavero del sistema no está disponible. Define PRECIO_CLARO_SERPAPI_KEY en el entorno en lugar de guardar la clave.');
      }
      this.data.encryptedApiKey = safeStorage.encryptString(submittedKey).toString('base64');
    }

    await this.save();
    return this.getPublicState();
  }

  async addProduct(input = {}) {
    const name = cleanText(input.name, 140);
    const query = cleanText(input.query, 200) || name;
    const category = cleanText(input.category, 80);

    if (name.length < 2) {
      throw new Error('Indica un nombre de producto de al menos 2 caracteres.');
    }
    if (this.data.products.length >= MAX_PRODUCTS) {
      throw new Error(`El catálogo admite un máximo de ${MAX_PRODUCTS} productos.`);
    }

    const duplicate = this.data.products.some((product) => product.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es') && product.query.toLocaleLowerCase('es') === query.toLocaleLowerCase('es'));
    if (duplicate) {
      throw new Error('Ese producto ya está en el catálogo.');
    }

    const product = {
      id: randomUUID(),
      name,
      query,
      category,
      createdAt: new Date().toISOString(),
      lastSearchAt: null,
      lastSearchError: '',
      offers: []
    };
    this.data.products.push(product);
    await this.save();
    return { ...product, offers: [] };
  }

  async importProducts(rows) {
    if (!Array.isArray(rows)) throw new Error('El archivo de catálogo no tiene un formato válido.');

    let imported = 0;
    let skipped = 0;
    for (const row of rows.slice(0, MAX_PRODUCTS)) {
      const name = cleanText(row?.name, 140);
      const query = cleanText(row?.query, 200) || name;
      const category = cleanText(row?.category, 80);
      if (name.length < 2 || this.data.products.length >= MAX_PRODUCTS) {
        skipped += 1;
        continue;
      }
      const duplicate = this.data.products.some((product) => product.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es') && product.query.toLocaleLowerCase('es') === query.toLocaleLowerCase('es'));
      if (duplicate) {
        skipped += 1;
        continue;
      }
      this.data.products.push({
        id: randomUUID(),
        name,
        query,
        category,
        createdAt: new Date().toISOString(),
        lastSearchAt: null,
        lastSearchError: '',
        offers: []
      });
      imported += 1;
    }
    await this.save();
    return { imported, skipped, state: this.getPublicState() };
  }

  async deleteProduct(id) {
    const index = this.data.products.findIndex((product) => product.id === id);
    if (index === -1) throw new Error('El producto ya no existe.');
    this.data.products.splice(index, 1);
    await this.save();
    return this.getPublicState();
  }

  async recordSearch(productId, offers) {
    const product = this.data.products.find((item) => item.id === productId);
    if (!product) throw new Error('El producto ya no existe.');
    product.offers = Array.isArray(offers)
      ? offers.map(normalizeOffer).filter(Boolean).slice(0, MAX_OFFERS_PER_PRODUCT)
      : [];
    product.lastSearchAt = new Date().toISOString();
    product.lastSearchError = '';
    await this.save();
  }

  async recordSearchError(productId, message) {
    const product = this.data.products.find((item) => item.id === productId);
    if (!product) return;
    product.lastSearchAt = new Date().toISOString();
    product.lastSearchError = cleanText(message, 500) || 'La búsqueda no ha podido completarse.';
    await this.save();
  }

  async save() {
    const content = `${JSON.stringify(this.data, null, 2)}\n`;
    this.saveQueue = this.saveQueue.then(async () => {
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, content, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    });
    return this.saveQueue;
  }
}

module.exports = { PriceStore, cleanText };
