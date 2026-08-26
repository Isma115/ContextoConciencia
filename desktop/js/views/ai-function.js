import { $ } from '../core/dom.js';

let navigate = () => {};

export function configureAiFunction({ onNavigate } = {}) {
  navigate = onNavigate || navigate;
}

export function renderAiFunction() {
  $('#view-ai-function').innerHTML = `<div class="section-top ai-function-top"><div><span class="ai-function-eyebrow">NEXUSDATA / INTELIGENCIA</span><h1>Función IA</h1><p class="lead">Un espacio para trabajar con la información técnica de tu proyecto con ayuda de inteligencia artificial.</p></div><span class="ai-function-status">EN PREPARACIÓN</span></div><div class="ai-function-grid"><section class="panel ai-function-hero"><div class="ai-function-mark" aria-hidden="true">✦</div><div><span class="ai-function-kicker">ASISTENTE DE PROYECTO</span><h2>Convierte tu documentación en contexto útil</h2><p>Esta vista será el punto de entrada para consultar, resumir y relacionar los documentos que ya tienes centralizados en NexusData.</p></div></section><section class="panel ai-function-capabilities"><div class="panel-header"><div><h2>Capacidades previstas</h2><p>Preparadas para integrarse con tu índice local.</p></div></div><div class="ai-function-capability-list"><div class="ai-function-capability"><span class="ai-function-capability-icon">⌕</span><div><strong>Preguntar sobre el proyecto</strong><span>Obtén respuestas basadas en tus fuentes y documentos.</span></div></div><div class="ai-function-capability"><span class="ai-function-capability-icon">≡</span><div><strong>Resumir información</strong><span>Reduce documentos extensos a las ideas que necesitas.</span></div></div><div class="ai-function-capability"><span class="ai-function-capability-icon">↗</span><div><strong>Conectar conceptos</strong><span>Relaciona decisiones, configuraciones y referencias técnicas.</span></div></div></div></section></div><section class="panel ai-function-next-step"><div><span class="ai-function-kicker">SIGUIENTE PASO</span><h2>Tu contexto ya está listo para crecer</h2><p>Selecciona una fuente desde Fuentes o explora el índice en Buscador Global mientras se configura el proveedor de IA.</p></div><div class="ai-function-actions"><button class="btn btn-secondary" type="button" data-ai-navigate="sources">Ver fuentes</button><button class="btn btn-primary" type="button" data-ai-navigate="global-search">Abrir Buscador Global</button></div></section></div>`;

  $('#view-ai-function').querySelectorAll('[data-ai-navigate]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.aiNavigate)));
}
