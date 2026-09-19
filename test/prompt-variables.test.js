const assert = require('node:assert/strict');
const test = require('node:test');

// Prompts configurables con variables globales de la aplicación.
//
// `prompt-variables.js` lee el estado real (state.sddProject.activeVersion), así que
// la prueba carga un almacenamiento local mínimo antes de importar los módulos y
// luego simula el cambio de versión activa en S.D.D.

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  }
};

let clipboard = '';
// `navigator` es un getter de solo lectura en Node, así que se redefine como propiedad.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: { clipboard: { writeText: async (text) => { clipboard = text; } } }
});
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
  body: { appendChild() {} },
  execCommand: () => false
};

const variables = import('../desktop/js/core/prompt-variables.js');
const store = import('../desktop/js/core/prompt-store.js');
const stateModule = import('../desktop/js/core/state.js');
const sddStorage = import('../desktop/js/core/sdd-storage.js');
const specsPrompt = import('../desktop/js/views/specs-prompt.js');
const promptConfig = import('../desktop/js/views/prompt-config.js');

async function setActiveVersion(version, project = {}) {
  const { state } = await stateModule;
  state.sddProject = version
    ? { name: 'Proyecto de prueba', path: '/tmp/proyecto', versions: [{ name: version }], activeVersion: version, ...project }
    : null;
}

test('la variable global version_specs_actual devuelve la versión activa de S.D.D.', async () => {
  const { getPromptGlobalVariables, resolvePromptGlobalVariable } = await variables;
  await setActiveVersion('1.2.0');

  assert.equal(resolvePromptGlobalVariable('version_specs_actual'), '1.2.0');
  assert.equal(resolvePromptGlobalVariable('VERSION_SPECS_ACTUAL'), '1.2.0');
  assert.equal(resolvePromptGlobalVariable('version_inexistente'), '');

  const byToken = Object.fromEntries(getPromptGlobalVariables().map((variable) => [variable.tokenName, variable.value]));
  assert.equal(byToken.archivo_specs_actual, '1.2.0.md');
  assert.equal(byToken.ruta_specs_actual, 'SDD_specs/specs/1.2.0.md');
  assert.equal(byToken.archivo_specs_completo, 'SDD_specs/specs_full.md');

  await setActiveVersion('');
  assert.equal(resolvePromptGlobalVariable('version_specs_actual'), '');
});

test('replacePromptVariables resuelve variables globales y conserva las propias del prompt', async () => {
  const { replacePromptVariables } = await store;
  await setActiveVersion('2.0.1');

  assert.equal(
    replacePromptVariables('Solamente ten en cuenta [version_specs_actual].md'),
    'Solamente ten en cuenta 2.0.1.md'
  );
  assert.equal(
    replacePromptVariables('Lee [ruta_specs_actual] del proyecto [nombre_proyecto].'),
    'Lee SDD_specs/specs/2.0.1.md del proyecto Proyecto de prueba.'
  );
  assert.equal(replacePromptVariables('Representa [FUNCIONALIDAD].'), 'Representa [FUNCIONALIDAD].');
  assert.equal(
    replacePromptVariables('Representa [funcionalidad].', { FUNCIONALIDAD: 'el alta de usuarios' }),
    'Representa el alta de usuarios.'
  );
  assert.equal(replacePromptVariables('Token libre [LO_QUE_SEA].'), 'Token libre [LO_QUE_SEA].');
});

test('la versión global manda salvo que el prompt defina su propio token', async () => {
  const { replacePromptVariables } = await store;
  await setActiveVersion('3.4.5');

  assert.equal(replacePromptVariables('[version_specs_actual]', { version_specs_actual: 'otra' }), 'otra');
});

test('el prompt predeterminado para trabajar siguiendo specs apunta solo a la versión activa', async () => {
  const { getDefaultFollowSpecsPrompt, buildFollowSpecsPrompt, getFollowSpecsVersionTokens } = await specsPrompt;
  await setActiveVersion('0.9.9');

  assert.match(getDefaultFollowSpecsPrompt(), /\[version_specs_actual\]/);
  assert.deepEqual(getFollowSpecsVersionTokens(), ['[version_specs_actual]']);

  const prompt = buildFollowSpecsPrompt();
  assert.match(prompt, /ten en cuenta solamente el fichero "SDD_specs\/specs\/0\.9\.9\.md"/);
  assert.doesNotMatch(prompt, /\[version_specs_actual\]/);

  await setActiveVersion('1.0.0');
  assert.match(buildFollowSpecsPrompt(), /SDD_specs\/specs\/1\.0\.0\.md/);
});

test('un prompt personalizado del usuario también recibe las variables globales', async () => {
  const { savePromptOverride, getPromptOverride } = await store;
  const { buildFollowSpecsPrompt } = await specsPrompt;
  await setActiveVersion('4.1.0');

  savePromptOverride('follow-specs', 'Trabaja solo con [version_specs_actual].md y su ruta [ruta_specs_actual].');
  assert.match(getPromptOverride('follow-specs'), /\[version_specs_actual\]/);
  assert.equal(
    buildFollowSpecsPrompt(),
    'Trabaja solo con 4.1.0.md y su ruta SDD_specs/specs/4.1.0.md.'
  );
});

test('copiar un prompt desde la biblioteca sustituye las variables globales', async () => {
  const { copyPromptById } = await promptConfig;
  await setActiveVersion('5.2.0');

  clipboard = '';
  await copyPromptById('follow-specs');
  assert.match(clipboard, /SDD_specs\/specs\/5\.2\.0\.md/);
  assert.doesNotMatch(clipboard, /\[version_specs_actual\]/);

  clipboard = '';
  await copyPromptById('new-diagram');
  assert.match(clipboard, /\[FUNCIONALIDAD\]/, 'el token que pide datos al usuario debe conservarse');
});

test('sin proyecto cargado se usa la ruta y la versión recordadas en el equipo', async () => {
  const { resolvePromptGlobalVariable } = await variables;
  const { SDD_PROJECT_PATH_STORAGE_KEY, SDD_ACTIVE_VERSION_STORAGE_KEY } = await sddStorage;
  const path = '/tmp/proyecto-recordado';
  storage.set(SDD_PROJECT_PATH_STORAGE_KEY, path);
  storage.set(`${SDD_ACTIVE_VERSION_STORAGE_KEY}:${path}`, '9.9.9');
  await setActiveVersion('');

  assert.equal(resolvePromptGlobalVariable('version_specs_actual'), '9.9.9');
  assert.equal(resolvePromptGlobalVariable('ruta_specs_actual'), 'SDD_specs/specs/9.9.9.md');
  assert.equal(resolvePromptGlobalVariable('nombre_proyecto'), 'proyecto-recordado');
  assert.equal(resolvePromptGlobalVariable('ruta_proyecto'), path);

  storage.delete(SDD_PROJECT_PATH_STORAGE_KEY);
  storage.delete(`${SDD_ACTIVE_VERSION_STORAGE_KEY}:${path}`);
  assert.equal(resolvePromptGlobalVariable('version_specs_actual'), '');
});

test('sin proyecto S.D.D. la variable de versión se resuelve a vacío y se avisa en la interfaz', async () => {
  const { getPromptGlobalVariables, resolvePromptGlobalVariable } = await variables;
  const { replacePromptVariables } = await store;
  const { renderPromptConfig } = await promptConfig;

  await setActiveVersion('');
  assert.equal(resolvePromptGlobalVariable('version_specs_actual'), '');
  assert.equal(replacePromptVariables('Versión: [version_specs_actual].'), 'Versión: .');
  assert.equal(
    getPromptGlobalVariables().find((variable) => variable.tokenName === 'version_specs_actual').available,
    false
  );

  await setActiveVersion('7.0.0');
  const fakeRoot = { innerHTML: '', addEventListener() {} };
  const originalQuerySelector = globalThis.document.querySelector;
  globalThis.document.querySelector = (selector) => (selector === '#view-prompt-config' ? fakeRoot : null);
  try {
    renderPromptConfig();
    assert.match(fakeRoot.innerHTML, /Variables globales/);
    assert.match(fakeRoot.innerHTML, /\[version_specs_actual\]/);
    // Se cuenta el `<textarea>` real: el rótulo repite el identificador en sus
    // atributos `for`, `id` y `class`, que también terminan en `prompt-config-content`.
    assert.equal((fakeRoot.innerHTML.match(/<textarea id="prompt-config-content"/g) || []).length, 1, 'el contenido del prompt se edita una sola vez');
    assert.doesNotMatch(fakeRoot.innerHTML, /prompt-config-preview/, 'no debe duplicarse el prompt con una preview');
  } finally {
    globalThis.document.querySelector = originalQuerySelector;
  }
});
