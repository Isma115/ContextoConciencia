const api = window.precioClaro;

const refs = {
  sideProductCount: document.querySelector('#side-product-count'),
  sideOfferCount: document.querySelector('#side-offer-count'),
  providerPulse: document.querySelector('#provider-pulse'),
  providerStatus: document.querySelector('#provider-status'),
  metricProducts: document.querySelector('#metric-products'),
  metricLowest: document.querySelector('#metric-lowest'),
  metricLowestMeta: document.querySelector('#metric-lowest-meta'),
  metricUpdated: document.querySelector('#metric-updated'),
  metricUpdatedMeta: document.querySelector('#metric-updated-meta'),
  catalogRows: document.querySelector('#catalog-rows'),
  catalogTable: document.querySelector('.catalog-table'),
  emptyCatalog: document.querySelector('#empty-catalog'),
  emptyFilter: document.querySelector('#empty-filter'),
  offerHeading: document.querySelector('#offers-heading'),
  offerQuery: document.querySelector('#offer-query'),
  offerCount: document.querySelector('#offer-count'),
  offerList: document.querySelector('#offer-list'),
  offerEmpty: document.querySelector('#offer-empty'),
  searchAll: document.querySelector('#search-all'),
  importCsv: document.querySelector('#import-csv'),
  filterProducts: document.querySelector('#filter-products'),
  addDialog: document.querySelector('#add-product-dialog'),
  addForm: document.querySelector('#add-product-form'),
  productName: document.querySelector('#product-name'),
  productQuery: document.querySelector('#product-query'),
  productCategory: document.querySelector('#product-category'),
  addSubmit: document.querySelector('#add-product-submit'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsForm: document.querySelector('#settings-form'),
  settingsApiKey: document.querySelector('#settings-api-key'),
  settingsCountry: document.querySelector('#settings-country'),
  settingsLanguage: document.querySelector('#settings-language'),
  settingsCurrency: document.querySelector('#settings-currency'),
  settingsClearKey: document.querySelector('#settings-clear-key'),
  clearKeyRow: document.querySelector('#clear-key-row'),
  apiKeyStatus: document.querySelector('#api-key-status'),
  settingsSubmit: document.querySelector('#settings-submit'),
  toast: document.querySelector('#toast')
};

let state = {
  settings: { country: 'ES', language: 'es', currency: 'EUR', apiKeyConfigured: false },
  products: []
};
let selectedProductId = null;
let filterText = '';
let isSearching = false;
let progress = null;
let toastTimer;

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function validPrice(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function currencyFormatter(currency) {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: currency || state.settings.currency,
      maximumFractionDigits: 2
    });
  } catch {
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
  }
}

function formatMoney(value, currency = state.settings.currency) {
  return validPrice(value) ? currencyFormatter(currency).format(Number(value)) : '—';
}

function formatDate(value, { includeTime = true } = {}) {
  if (!value) return 'Sin actualizar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin actualizar';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function isComparableOffer(offer) {
  return validPrice(offer?.totalPrice) && offer.currency === state.settings.currency;
}

function getBestOffer(product) {
  return product.offers
    .filter(isComparableOffer)
    .sort((left, right) => Number(left.totalPrice) - Number(right.totalPrice))[0] || null;
}

function getSortedOffers(product) {
  return [...product.offers].sort((left, right) => {
    const leftComparable = isComparableOffer(left);
    const rightComparable = isComparableOffer(right);
    if (leftComparable !== rightComparable) return leftComparable ? -1 : 1;
    if (left.currency !== right.currency) return String(left.currency).localeCompare(String(right.currency), 'es');
    return Number(left.totalPrice) - Number(right.totalPrice);
  });
}

function getSortedProducts() {
  const normalizedFilter = filterText.trim().toLocaleLowerCase('es');
  return state.products
    .filter((product) => {
      if (!normalizedFilter) return true;
      return [product.name, product.query, product.category]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase('es').includes(normalizedFilter));
    })
    .map((product) => ({ product, best: getBestOffer(product) }))
    .sort((left, right) => {
      if (!left.best && !right.best) return left.product.name.localeCompare(right.product.name, 'es');
      if (!left.best) return 1;
      if (!right.best) return -1;
      const difference = Number(left.best.totalPrice) - Number(right.best.totalPrice);
      return difference || left.product.name.localeCompare(right.product.name, 'es');
    });
}

function getSelectedProduct() {
  return state.products.find((product) => product.id === selectedProductId) || null;
}

function showToast(message, kind = 'success') {
  clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.dataset.kind = kind;
  refs.toast.classList.add('visible');
  toastTimer = setTimeout(() => refs.toast.classList.remove('visible'), 4800);
}

function renderProvider() {
  const configured = state.settings.apiKeyConfigured;
  refs.providerPulse.classList.toggle('ready', configured);
  refs.providerStatus.textContent = configured ? 'Proveedor listo para buscar' : 'Proveedor sin configurar';
}

function renderMetrics() {
  const productsWithOffers = state.products.filter((product) => getBestOffer(product));
  const allBestOffers = productsWithOffers.map(getBestOffer).filter(Boolean);
  const lowest = [...allBestOffers].sort((left, right) => left.totalPrice - right.totalPrice)[0];
  const dates = state.products
    .map((product) => product.lastSearchAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right) - new Date(left));

  refs.sideProductCount.textContent = String(state.products.length);
  refs.sideOfferCount.textContent = String(state.products.reduce((total, product) => total + product.offers.length, 0));
  refs.metricProducts.textContent = String(state.products.length);
  refs.metricLowest.textContent = lowest ? formatMoney(lowest.totalPrice, lowest.currency) : '—';
  refs.metricLowestMeta.textContent = lowest ? `${lowest.source} · ${lowest.title}` : 'Aún no hay precios comparables';
  refs.metricUpdated.textContent = dates[0] ? formatDate(dates[0], { includeTime: false }) : '—';
  refs.metricUpdatedMeta.textContent = dates[0] ? `Última búsqueda: ${formatDate(dates[0])}` : 'Sin búsquedas todavía';
}

function productLabel(product) {
  const wrapper = createElement('div', 'product-cell');
  wrapper.append(createElement('strong', 'product-name', product.name));
  wrapper.append(createElement('span', 'product-query', product.query));
  if (product.category) wrapper.append(createElement('span', 'category-tag', product.category));
  return wrapper;
}

function bestOfferCell(product, best) {
  const wrapper = createElement('div', 'best-offer-cell');
  if (best) {
    wrapper.append(createElement('strong', 'price', formatMoney(best.totalPrice, best.currency)));
    const message = best.shippingKnown
      ? best.shippingPrice && best.shippingPrice > 0
        ? `incluye ${formatMoney(best.shippingPrice, best.currency)} de envío`
        : 'envío incluido'
      : 'envío por confirmar';
    wrapper.append(createElement('span', 'shipping-note', message));
  } else if (product.lastSearchAt && product.offers.length) {
    wrapper.append(createElement('strong', 'unavailable-price', 'Moneda no comparable'));
    wrapper.append(createElement('span', 'shipping-note', `Se muestran precios en ${state.settings.currency}`));
  } else if (product.lastSearchError) {
    wrapper.append(createElement('strong', 'error-price', 'Búsqueda fallida'));
    wrapper.append(createElement('span', 'shipping-note', 'Reintenta la búsqueda'));
  } else if (product.lastSearchAt) {
    wrapper.append(createElement('strong', 'unavailable-price', 'Sin resultados'));
    wrapper.append(createElement('span', 'shipping-note', 'Prueba una consulta más precisa'));
  } else {
    wrapper.append(createElement('strong', 'unavailable-price', 'Pendiente'));
    wrapper.append(createElement('span', 'shipping-note', 'Aún no se ha buscado'));
  }
  return wrapper;
}

function makeActionButton(label, className, onClick, disabled = false) {
  const button = createElement('button', className, label);
  button.type = 'button';
  button.disabled = disabled;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderCatalog() {
  const items = getSortedProducts();
  if (!selectedProductId && items[0]) selectedProductId = items[0].product.id;
  if (selectedProductId && !state.products.some((product) => product.id === selectedProductId)) {
    selectedProductId = items[0]?.product.id || null;
  }

  refs.catalogRows.replaceChildren();
  const hasProducts = state.products.length > 0;
  refs.catalogTable.hidden = !hasProducts || items.length === 0;
  refs.emptyCatalog.hidden = hasProducts;
  refs.emptyFilter.hidden = !hasProducts || items.length > 0;

  for (const { product, best } of items) {
    const row = document.createElement('tr');
    row.tabIndex = 0;
    row.classList.toggle('selected', product.id === selectedProductId);
    row.setAttribute('aria-label', `Ver ofertas de ${product.name}`);
    row.addEventListener('click', () => {
      selectedProductId = product.id;
      renderCatalog();
      renderOffers();
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      }
    });

    const productCell = document.createElement('td');
    productCell.append(productLabel(product));
    const priceCell = document.createElement('td');
    priceCell.append(bestOfferCell(product, best));
    const sourceCell = document.createElement('td');
    sourceCell.append(createElement('span', 'source-name', best?.source || '—'));
    const updatedCell = document.createElement('td');
    updatedCell.append(createElement('span', product.lastSearchError ? 'date-error' : 'date', formatDate(product.lastSearchAt)));
    if (product.lastSearchError) updatedCell.title = product.lastSearchError;
    const actionCell = document.createElement('td');
    const actions = createElement('div', 'row-actions');
    actions.append(makeActionButton('Actualizar', 'row-search', () => searchOne(product), isSearching));
    actions.append(makeActionButton('×', 'row-delete', () => deleteProduct(product), isSearching));
    actions.lastChild.setAttribute('aria-label', `Eliminar ${product.name}`);
    actionCell.append(actions);
    row.append(productCell, priceCell, sourceCell, updatedCell, actionCell);
    refs.catalogRows.append(row);
  }
}

function offerImage(offer) {
  const fallback = createElement('div', 'offer-image fallback', '€');
  if (!offer.thumbnail) return fallback;
  const image = document.createElement('img');
  image.className = 'offer-image';
  image.src = offer.thumbnail;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => image.replaceWith(fallback), { once: true });
  return image;
}

function renderOffers() {
  const product = getSelectedProduct();
  refs.offerList.replaceChildren();

  if (!product) {
    refs.offerHeading.textContent = 'Selecciona un producto';
    refs.offerQuery.textContent = 'Elige una fila del catálogo para ver y abrir las ofertas.';
    refs.offerCount.textContent = '0 ofertas';
    refs.offerEmpty.hidden = false;
    return;
  }

  const offers = getSortedOffers(product);
  refs.offerHeading.textContent = product.name;
  refs.offerQuery.textContent = `Consulta: ${product.query}`;
  refs.offerCount.textContent = `${offers.length} ${offers.length === 1 ? 'oferta' : 'ofertas'}`;
  refs.offerEmpty.hidden = offers.length > 0;

  if (!offers.length) {
    const emptyText = product.lastSearchError
      ? `No se pudo completar la búsqueda: ${product.lastSearchError}`
      : product.lastSearchAt
        ? 'No se han encontrado ofertas con precio legible. Prueba con una consulta más específica.'
        : 'Aún no has buscado este producto. Pulsa Actualizar para consultar las ofertas.';
    refs.offerEmpty.querySelector('p').textContent = emptyText;
    return;
  }

  for (const offer of offers) {
    const article = createElement('article', `offer-row${isComparableOffer(offer) ? '' : ' foreign-currency'}`);
    article.append(offerImage(offer));
    const details = createElement('div', 'offer-details');
    const merchantLine = createElement('div', 'merchant-line');
    merchantLine.append(createElement('span', 'merchant', offer.source));
    if (offer.rating) merchantLine.append(createElement('span', 'rating', `★ ${Number(offer.rating).toFixed(1)}${offer.reviews ? ` (${offer.reviews})` : ''}`));
    details.append(merchantLine, createElement('h3', 'offer-title', offer.title));
    const shippingText = offer.shippingKnown
      ? offer.shippingLabel || 'Envío incluido'
      : 'Envío y condiciones por confirmar';
    details.append(createElement('p', 'offer-shipping', shippingText));

    const pricing = createElement('div', 'offer-pricing');
    pricing.append(createElement('strong', 'offer-price', formatMoney(offer.totalPrice, offer.currency)));
    if (offer.shippingKnown && Number(offer.shippingPrice) > 0) {
      pricing.append(createElement('span', 'base-price', `Base: ${formatMoney(offer.price, offer.currency)}`));
    } else if (!offer.shippingKnown) {
      pricing.append(createElement('span', 'base-price', 'Total sin envío conocido'));
    }
    const open = makeActionButton('Ver oferta ↗', 'offer-open', () => openOffer(offer.url));
    pricing.append(open);
    article.append(details, pricing);
    refs.offerList.append(article);
  }
}

function renderSearchButton() {
  refs.searchAll.disabled = isSearching;
  refs.importCsv.disabled = isSearching;
  if (!isSearching) {
    refs.searchAll.innerHTML = '<span aria-hidden="true">⌕</span> Buscar todo';
    return;
  }
  const suffix = progress?.total ? ` ${progress.index}/${progress.total}` : '';
  refs.searchAll.textContent = `Buscando${suffix}…`;
}

function render() {
  renderProvider();
  renderMetrics();
  renderSearchButton();
  renderCatalog();
  renderOffers();
}

async function refreshState() {
  state = await api.getState();
  render();
}

function openAddDialog() {
  refs.addForm.reset();
  refs.addDialog.showModal();
  window.setTimeout(() => refs.productName.focus(), 0);
}

function openSettingsDialog() {
  refs.settingsApiKey.value = '';
  refs.settingsCountry.value = state.settings.country;
  refs.settingsLanguage.value = state.settings.language;
  refs.settingsCurrency.value = state.settings.currency;
  refs.settingsClearKey.checked = false;
  refs.settingsClearKey.disabled = Boolean(state.settings.apiKeyFromEnvironment);
  refs.clearKeyRow.classList.toggle('muted', refs.settingsClearKey.disabled);

  if (state.settings.apiKeyFromEnvironment) {
    refs.apiKeyStatus.textContent = 'La aplicación está usando una clave definida en la variable de entorno PRECIO_CLARO_SERPAPI_KEY.';
  } else if (state.settings.apiKeyConfigured) {
    refs.apiKeyStatus.textContent = 'Hay una clave cifrada guardada en este equipo. Déjalo vacío para conservarla.';
  } else if (!state.settings.keyStorageAvailable) {
    refs.apiKeyStatus.textContent = 'El llavero del sistema no está disponible; usa la variable de entorno para configurar la clave.';
  } else {
    refs.apiKeyStatus.textContent = 'No hay ninguna clave configurada todavía.';
  }
  refs.settingsDialog.showModal();
  window.setTimeout(() => refs.settingsApiKey.focus(), 0);
}

async function submitAddProduct(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    refs.addDialog.close();
    return;
  }
  const input = {
    name: refs.productName.value,
    query: refs.productQuery.value,
    category: refs.productCategory.value
  };
  refs.addSubmit.disabled = true;
  try {
    state = await api.addProduct(input);
    selectedProductId = state.products.at(-1)?.id || selectedProductId;
    refs.addDialog.close();
    render();
    showToast('Producto añadido al catálogo.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    refs.addSubmit.disabled = false;
  }
}

async function submitSettings(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    refs.settingsDialog.close();
    return;
  }
  refs.settingsSubmit.disabled = true;
  try {
    state = await api.updateSettings({
      apiKey: refs.settingsApiKey.value,
      clearApiKey: refs.settingsClearKey.checked,
      country: refs.settingsCountry.value,
      language: refs.settingsLanguage.value,
      currency: refs.settingsCurrency.value
    });
    refs.settingsDialog.close();
    render();
    showToast('Configuración guardada. Ya puedes buscar las ofertas.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    refs.settingsSubmit.disabled = false;
  }
}

async function searchAll() {
  if (isSearching) return;
  isSearching = true;
  progress = null;
  render();
  try {
    const response = await api.searchAll();
    state = response.state;
    if (response.failed) {
      showToast(`Actualización terminada: ${response.completed} correctas y ${response.failed} con error.`, 'warning');
    } else {
      showToast(`Catálogo actualizado: ${response.completed} ${response.completed === 1 ? 'producto consultado' : 'productos consultados'}.`);
    }
  } catch (error) {
    showToast(error.message, 'error');
    await refreshState();
  } finally {
    isSearching = false;
    progress = null;
    render();
  }
}

async function searchOne(product) {
  if (isSearching) return;
  isSearching = true;
  progress = { index: 0, total: 1, name: product.name };
  render();
  try {
    state = await api.searchOne(product.id);
    showToast(`Ofertas actualizadas para “${product.name}”.`);
  } catch (error) {
    showToast(error.message, 'error');
    await refreshState();
  } finally {
    isSearching = false;
    progress = null;
    render();
  }
}

async function deleteProduct(product) {
  if (isSearching) return;
  const confirmed = window.confirm(`¿Eliminar “${product.name}” y sus ofertas guardadas?`);
  if (!confirmed) return;
  try {
    state = await api.deleteProduct(product.id);
    if (selectedProductId === product.id) selectedProductId = null;
    render();
    showToast('Producto eliminado del catálogo.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function importCsv() {
  if (isSearching) return;
  try {
    const response = await api.importCsv();
    if (response.canceled) return;
    state = response.state;
    render();
    const skipped = response.skipped ? ` Se omitieron ${response.skipped} duplicados o filas no válidas.` : '';
    showToast(`Se importaron ${response.imported} productos.${skipped}`, response.imported ? 'success' : 'warning');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function openOffer(url) {
  try {
    await api.openOffer(url);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function bindEvents() {
  document.querySelector('#open-add-product').addEventListener('click', openAddDialog);
  document.querySelector('#empty-add-product').addEventListener('click', openAddDialog);
  document.querySelector('#open-settings').addEventListener('click', openSettingsDialog);
  refs.searchAll.addEventListener('click', searchAll);
  refs.importCsv.addEventListener('click', importCsv);
  refs.addForm.addEventListener('submit', submitAddProduct);
  refs.settingsForm.addEventListener('submit', submitSettings);
  refs.filterProducts.addEventListener('input', () => {
    filterText = refs.filterProducts.value;
    renderCatalog();
  });
  api.onSearchProgress((nextProgress) => {
    progress = nextProgress;
    if (isSearching) renderSearchButton();
  });
}

async function init() {
  bindEvents();
  try {
    await refreshState();
  } catch (error) {
    showToast(`No se ha podido cargar el catálogo: ${error.message}`, 'error');
  }
}

init();
