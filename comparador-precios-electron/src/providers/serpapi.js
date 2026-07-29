const { createHash } = require('node:crypto');

const SEARCH_TIMEOUT_MS = 25_000;

function readNumericPrice(value, { freeIsZero = false } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (freeIsZero && /^(gratis|free|env[ií]o gratis|free shipping)$/i.test(source)) return 0;
  const match = source.match(/\d[\d.,\s]*/);
  if (!match) return null;
  const token = match[0].replace(/\s/g, '');
  const commas = [...token.matchAll(/,/g)].map((item) => item.index);
  const dots = [...token.matchAll(/\./g)].map((item) => item.index);

  let normalized = token;
  if (commas.length && dots.length) {
    const decimalIsComma = commas.at(-1) > dots.at(-1);
    normalized = decimalIsComma
      ? token.replace(/\./g, '').replace(',', '.')
      : token.replace(/,/g, '');
  } else if (commas.length) {
    const tail = token.slice(commas.at(-1) + 1);
    normalized = tail.length === 3 && commas.length === 1 ? token.replace(',', '') : token.replace(/,/g, '.');
  } else if (dots.length) {
    const tail = token.slice(dots.at(-1) + 1);
    normalized = tail.length === 3 && dots.length === 1 ? token.replace('.', '') : token;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectCurrency(priceLabel, fallbackCurrency) {
  const source = String(priceLabel || '').toUpperCase();
  if (source.includes('€') || source.includes('EUR')) return 'EUR';
  if (source.includes('£') || source.includes('GBP')) return 'GBP';
  if (source.includes('US$') || source.includes('USD')) return 'USD';
  if (source.includes('$')) return 'USD';
  if (source.includes('JPY') || source.includes('¥')) return 'JPY';
  return fallbackCurrency;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function makeOffer(result, settings) {
  const priceLabel = String(result.price || '').trim();
  const price = Number.isFinite(Number(result.extracted_price))
    ? Number(result.extracted_price)
    : readNumericPrice(priceLabel);
  if (!Number.isFinite(price) || price < 0) return null;

  const shippingLabel = String(result.delivery || result.shipping || '').trim();
  const shippingPrice = readNumericPrice(shippingLabel, { freeIsZero: true });
  const shippingKnown = shippingPrice !== null || /(?:gratis|free)/i.test(shippingLabel);
  // Los resultados inline suelen incluir el enlace directo del comercio. En los
  // resultados agrupados puede existir únicamente una ficha de Google Shopping.
  const url = safeHttpUrl(result.link || result.product_link || '');
  if (!url) return null;

  const source = String(result.source || result.merchant || 'Tienda no identificada').trim();
  const title = String(result.title || 'Oferta sin título').trim();
  const currency = detectCurrency(priceLabel, settings.currency);
  const totalPrice = price + (shippingPrice ?? 0);
  const key = `${source}|${url}|${price}|${currency}`;

  return {
    id: createHash('sha256').update(key).digest('hex').slice(0, 24),
    title,
    source,
    url,
    price,
    totalPrice,
    currency,
    priceLabel,
    shippingLabel,
    shippingPrice,
    shippingKnown,
    thumbnail: safeHttpUrl(result.thumbnail || result.image || ''),
    rating: Number.isFinite(Number(result.rating)) ? Number(result.rating) : null,
    reviews: Number.isFinite(Number(result.reviews)) ? Number(result.reviews) : null,
    provider: 'serpapi',
    foundAt: new Date().toISOString()
  };
}

function tidyError(payload, response) {
  const remoteMessage = typeof payload?.error === 'string'
    ? payload.error
    : typeof payload?.message === 'string'
      ? payload.message
      : '';
  if (response.status === 401 || response.status === 403) {
    return 'La clave de SerpApi no es válida o no tiene permisos para consultar Google Shopping.';
  }
  if (response.status === 429) {
    return 'Se ha alcanzado el límite de consultas del proveedor. Espera unos minutos o revisa tu plan de SerpApi.';
  }
  return remoteMessage || `El proveedor devolvió un error HTTP ${response.status}.`;
}

async function searchWithSerpApi({ query, settings, apiKey }) {
  if (!apiKey) {
    throw new Error('Configura una clave de SerpApi en Ajustes para buscar ofertas reales en la web.');
  }
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('La consulta del producto está vacía.');
  }

  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google_shopping',
    q: query.trim(),
    api_key: apiKey,
    gl: settings.country.toLowerCase(),
    hl: settings.language,
    sort_by: '1'
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('La búsqueda ha tardado demasiado. Comprueba tu conexión e inténtalo de nuevo.');
    }
    throw new Error(`No se pudo conectar con el proveedor de precios: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('El proveedor devolvió una respuesta no válida.');
  }
  if (!response.ok || payload.error) {
    throw new Error(tidyError(payload, response));
  }

  const categorized = Array.isArray(payload.categorized_shopping_results)
    ? payload.categorized_shopping_results.flatMap((category) => Array.isArray(category.shopping_results) ? category.shopping_results : [])
    : [];
  const rawResults = [
    ...(Array.isArray(payload.inline_shopping_results) ? payload.inline_shopping_results : []),
    ...(Array.isArray(payload.shopping_results) ? payload.shopping_results : []),
    ...categorized
  ];
  const seen = new Set();
  return rawResults
    .map((result) => makeOffer(result, settings))
    .filter((offer) => {
      if (!offer) return false;
      const duplicate = seen.has(offer.id);
      seen.add(offer.id);
      return !duplicate;
    })
    .sort((left, right) => left.totalPrice - right.totalPrice);
}

module.exports = { searchWithSerpApi, readNumericPrice, detectCurrency };
