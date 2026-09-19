const assert = require('node:assert/strict');
const test = require('node:test');

// Sugerencia de la siguiente versión de specs: la usa el botón rápido del
// selector de versión y el valor por defecto de la ventana «Nueva versión».
// El módulo es puro (sin DOM), así que se puede importar directamente.

const versions = import('../desktop/js/core/sdd-version.js');

test('bumpSddVersionName incrementa el último grupo numérico', async () => {
  const { bumpSddVersionName } = await versions;

  assert.equal(bumpSddVersionName('0.0.1'), '0.0.2');
  assert.equal(bumpSddVersionName('0.0.0'), '0.0.1');
  assert.equal(bumpSddVersionName('1.9'), '1.10');
  assert.equal(bumpSddVersionName('v3'), 'v4');
  assert.equal(bumpSddVersionName('2024-01'), '2024-02');
  assert.equal(bumpSddVersionName('1.02'), '1.03');
  assert.equal(bumpSddVersionName('1.0.0-rc2'), '1.0.0-rc3');
  // Sin dígitos no hay nada que incrementar: se añade un contador.
  assert.equal(bumpSddVersionName('beta'), 'beta-2');
  assert.equal(bumpSddVersionName(''), '');
});

test('nextSddVersionName sugiere la siguiente versión de la versión activa', async () => {
  const { nextSddVersionName } = await versions;

  assert.equal(nextSddVersionName(['0.0.1'], '0.0.1'), '0.0.2');
  assert.equal(nextSddVersionName([{ name: '0.0.1' }, { name: '0.0.2' }], '0.0.1'), '0.0.3');
  // Acepta nombres sueltos además de los objetos del proyecto.
  assert.equal(nextSddVersionName([{ name: '1.0.0' }, '1.0.1'], '1.0.1'), '1.0.2');
});

test('nextSddVersionName no repite una versión existente', async () => {
  const { nextSddVersionName } = await versions;

  assert.equal(nextSddVersionName(['0.0.1', '0.0.2', '0.0.3'], '0.0.1'), '0.0.4');
  assert.equal(nextSddVersionName(['1.0.0', '1.0.1'], '1.0.0'), '1.0.2');
});

test('nextSddVersionName usa la versión más alta cuando la activa no está en la lista', async () => {
  const { nextSddVersionName } = await versions;

  // La comparación es numérica: 1.10.0 es posterior a 1.9.0.
  assert.equal(nextSddVersionName(['1.9.0', '1.10.0'], 'inexistente'), '1.10.1');
  assert.equal(nextSddVersionName(['1.9.0', '1.10.0'], ''), '1.10.1');
  // Sin versiones en el proyecto se parte de la versión activa recordada.
  assert.equal(nextSddVersionName([], '2.0.0'), '2.0.1');
  // Sin ninguna referencia no hay sugerencia.
  assert.equal(nextSddVersionName([], ''), '');
  assert.equal(nextSddVersionName(null, null), '');
});
