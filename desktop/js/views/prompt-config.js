import { $, escapeHtml } from '../core/dom.js';
import {
  BUILTIN_PROMPT_DEFINITIONS,
  deleteCustomPrompt,
  getCustomPrompt,
  getPromptOverride,
  listCustomPrompts,
  promptMenuItems,
  replacePromptVariables,
  resetPromptOverride,
  saveCustomPrompt,
  savePromptOverride
} from '../core/prompt-store.js';
import { showToast } from '../ui/notifications.js';
import {
  getDefaultDiagramPromptTemplate,
  getDefaultGitDiffPrompt
} from './diagram-prompt-modal.js';
import {
  getDefaultCompletedSpecsPrompt,
  getDefaultFollowSpecsPrompt,
  readStoredSddPromptIncludeFull,
  readStoredSddPromptSkipTests
} from './specs-prompt.js';

let selectedPromptId = 'new-diagram';
let editorMode = 'selected';
let configured = false;

function defaultPromptContent(id) {
  if (id === 'new-diagram') return getDefaultDiagramPromptTemplate();
  if (id === 'git-diff') return getDefaultGitDiffPrompt();
  if (id === 'completed-specs') return getDefaultCompletedSpecsPrompt({ includeFull: readStoredSddPromptIncludeFull() });
  if (id === 'follow-specs') return getDefaultFollowSpecsPrompt({ skipTests: readStoredSddPromptSkipTests() });
  return '';
}

function builtInEntry(definition) {
  const override = getPromptOverride(definition.id);
  return {
    ...definition,
    builtIn: true,
    customized: Boolean(override),
    content: override || defaultPromptContent(definition.id)
  };
}

function promptEntries() {
  return [
    ...BUILTIN_PROMPT_DEFINITIONS.map(builtInEntry),
    ...listCustomPrompts().map((prompt) => ({ ...prompt, builtIn: false, customized: true }))
  ];
}

function selectedEntry() {
  return promptEntries().find((prompt) => prompt.id === selectedPromptId) || null;
}

function promptKindLabel(prompt) {
  if (prompt.builtIn) return prompt.customized ? 'Personalizado' : 'Predeterminado';
  return 'Nuevo';
}

function promptListItem(prompt) {
  return `<button class="prompt-config-item${prompt.id === selectedPromptId && editorMode === 'selected' ? ' is-selected' : ''}" type="button" data-prompt-select="${escapeHtml(prompt.id)}" aria-pressed="${String(prompt.id === selectedPromptId && editorMode === 'selected')}"><span class="prompt-config-item-copy"><strong>${escapeHtml(prompt.name)}</strong><small>${escapeHtml(promptKindLabel(prompt))}</small></span></button>`;
}

function editorMarkup(prompt) {
  if (editorMode === 'new') {
    return `<section class="panel prompt-config-editor">
      <div class="prompt-config-editor-head"><h2>Añadir prompt</h2></div>
      <form id="prompt-config-editor-form" class="prompt-config-editor-form" data-prompt-kind="custom">
        <label class="form-label" for="prompt-config-name">Nombre<input id="prompt-config-name" class="field" name="name" maxlength="120" placeholder="Ej. Revisar una API" required></label>
        <label class="form-label prompt-config-content-label" for="prompt-config-content">Contenido<textarea id="prompt-config-content" class="textarea prompt-config-content" name="content" maxlength="200000" placeholder="Escribe aquí las instrucciones del prompt…" required></textarea></label>
        <div class="prompt-config-actions"><button class="btn btn-secondary" type="button" data-prompt-action="cancel-new">Cancelar</button><button class="btn btn-primary" type="submit">Guardar prompt</button></div>
      </form>
    </section>`;
  }

  if (!prompt) {
    return `<section class="panel prompt-config-editor prompt-config-editor-empty"><strong>Selecciona un prompt</strong><span>Elige uno de la lista o añade uno nuevo.</span></section>`;
  }

  const customForm = !prompt.builtIn;
  return `<section class="panel prompt-config-editor">
    <div class="prompt-config-editor-head"><h2>${escapeHtml(prompt.name)}</h2><span class="prompt-config-status${prompt.customized ? ' is-customized' : ''}">${escapeHtml(promptKindLabel(prompt))}</span></div>
    <form id="prompt-config-editor-form" class="prompt-config-editor-form" data-prompt-kind="${customForm ? 'custom' : 'builtin'}" data-prompt-id="${escapeHtml(prompt.id)}">
      ${customForm ? `<label class="form-label" for="prompt-config-name">Nombre<input id="prompt-config-name" class="field" name="name" maxlength="120" value="${escapeHtml(prompt.name)}" required></label>` : ''}
      <label class="form-label prompt-config-content-label" for="prompt-config-content">Contenido<textarea id="prompt-config-content" class="textarea prompt-config-content" name="content" maxlength="200000" required>${escapeHtml(prompt.content)}</textarea></label>
      ${prompt.id === 'new-diagram' ? '<p class="prompt-config-help">Usa [FUNCIONALIDAD] para insertar la descripción del diagrama.</p>' : ''}
      ${prompt.id === 'follow-specs' ? '<p class="prompt-config-help">Usa [SIN_TESTS] para conservar la opción de no ejecutar tests.</p>' : ''}
      <div class="prompt-config-actions"><button class="btn btn-secondary" type="button" data-prompt-action="copy" data-prompt-id="${escapeHtml(prompt.id)}">Copiar</button>${prompt.builtIn && prompt.customized ? `<button class="btn btn-danger" type="button" data-prompt-action="reset" data-prompt-id="${escapeHtml(prompt.id)}">Restablecer</button>` : ''}${customForm ? `<button class="btn btn-danger" type="button" data-prompt-action="delete" data-prompt-id="${escapeHtml(prompt.id)}">Eliminar</button>` : ''}<button class="btn btn-primary" type="submit">${prompt.builtIn ? 'Guardar cambios' : 'Guardar prompt'}</button></div>
    </form>
  </section>`;
}

function renderPromptConfigMarkup() {
  const entries = promptEntries();
  if (editorMode === 'selected' && !entries.some((prompt) => prompt.id === selectedPromptId)) selectedPromptId = entries[0]?.id || null;
  const builtIns = entries.filter((prompt) => prompt.builtIn);
  const custom = entries.filter((prompt) => !prompt.builtIn);
  const prompt = selectedEntry();
  return `<div class="prompt-config-shell">
    <div class="prompt-config-header"><div><h1>Configurar prompts</h1><p class="lead">Edita un prompt o crea uno nuevo.</p></div><button class="btn btn-primary" type="button" data-prompt-action="add">＋ Nuevo prompt</button></div>
    <div class="prompt-config-layout">
      <section class="panel prompt-config-library" aria-label="Lista de prompts"><div class="prompt-config-group"><span class="prompt-config-group-label">Del programa</span><div class="prompt-config-list">${builtIns.map(promptListItem).join('')}</div></div>${custom.length ? `<div class="prompt-config-group"><span class="prompt-config-group-label">Mis prompts</span><div class="prompt-config-list">${custom.map(promptListItem).join('')}</div></div>` : ''}</section>
      ${editorMarkup(prompt)}
    </div>
  </div>`;
}

function writePromptMenu() {
  try {
    const update = window.nexusData?.updatePromptMenu;
    if (typeof update === 'function') Promise.resolve(update(promptMenuItems())).catch(() => {});
  } catch {
    // El menú nativo es opcional; la biblioteca sigue funcionando sin él.
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('El portapapeles no está disponible');
}

function promptContentForCopy(id) {
  const custom = getCustomPrompt(id);
  if (custom) return custom.content;
  const definition = BUILTIN_PROMPT_DEFINITIONS.find((item) => item.id === id);
  if (!definition) return '';
  if (id === 'new-diagram') return replacePromptVariables(getPromptOverride(id) || defaultPromptContent(id), { FUNCIONALIDAD: '[FUNCIONALIDAD]' });
  if (id === 'follow-specs') {
    const skipTests = readStoredSddPromptSkipTests();
    return replacePromptVariables(getPromptOverride(id) || defaultPromptContent(id), {
      SIN_TESTS: skipTests ? '- No realices pruebas sobre los cambios aplicados ni ejecutes tests.' : ''
    });
  }
  return getPromptOverride(id) || defaultPromptContent(id);
}

export async function copyPromptById(id) {
  const content = promptContentForCopy(id);
  if (!content.trim()) {
    showToast('El prompt está vacío', true);
    return;
  }
  try {
    await copyTextToClipboard(content);
    showToast('Prompt copiado al portapapeles');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt', true);
  }
}

function bindPromptConfigEvents() {
  const root = $('#view-prompt-config');
  if (!root || configured) return;
  configured = true;
  root.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-prompt-action]');
    const selectButton = event.target.closest('[data-prompt-select]');
    if (selectButton) {
      selectedPromptId = selectButton.dataset.promptSelect || null;
      editorMode = 'selected';
      renderPromptConfig();
      return;
    }
    if (!actionButton) return;
    const action = actionButton.dataset.promptAction;
    const id = actionButton.dataset.promptId || '';
    if (action === 'add') {
      selectedPromptId = null;
      editorMode = 'new';
      renderPromptConfig();
      $('#prompt-config-name')?.focus();
      return;
    }
    if (action === 'cancel-new') {
      editorMode = 'selected';
      selectedPromptId = promptEntries()[0]?.id || null;
      renderPromptConfig();
      return;
    }
    if (action === 'copy') {
      void copyPromptById(id);
      return;
    }
    if (action === 'reset') {
      if (!window.confirm('¿Restablecer este prompt a su contenido original?')) return;
      resetPromptOverride(id);
      renderPromptConfig();
      writePromptMenu();
      showToast('Prompt restablecido');
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('¿Eliminar este prompt personalizado?')) return;
      deleteCustomPrompt(id);
      selectedPromptId = 'new-diagram';
      editorMode = 'selected';
      renderPromptConfig();
      writePromptMenu();
      showToast('Prompt eliminado');
    }
  });
  root.addEventListener('submit', (event) => {
    const form = event.target.closest('#prompt-config-editor-form');
    if (!form) return;
    event.preventDefault();
    const content = form.querySelector('[name="content"]')?.value || '';
    const kind = form.dataset.promptKind;
    try {
      if (kind === 'builtin') {
        savePromptOverride(form.dataset.promptId, content);
        selectedPromptId = form.dataset.promptId;
      } else {
        const saved = saveCustomPrompt({
          id: form.dataset.promptId || undefined,
          name: form.querySelector('[name="name"]')?.value || '',
          content
        });
        selectedPromptId = saved.id;
      }
      editorMode = 'selected';
      renderPromptConfig();
      writePromptMenu();
      showToast('Prompt guardado');
    } catch (error) {
      showToast(error.message || 'No se pudo guardar el prompt', true);
    }
  });
}

export function configurePromptConfig() {
  bindPromptConfigEvents();
  writePromptMenu();
}

export function renderPromptConfig() {
  const root = $('#view-prompt-config');
  if (!root) return;
  root.innerHTML = renderPromptConfigMarkup();
  bindPromptConfigEvents();
}
