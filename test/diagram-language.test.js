const assert = require('node:assert/strict');
const test = require('node:test');

const language = import('../desktop/js/views/diagram-language.mjs');

test('genera nodos y conexiones desde el lenguaje textual', async () => {
  const { parseDiagramText } = await language;
  const diagram = parseDiagramText(`diagram "Flujo de acceso"

node inicio "Inicio" inicio at 100, 180
node validar "Validar credenciales" decisión at 420, 180
node panel "Panel principal" fin at 760, 180

edge inicio -> validar "Enviar datos" forward
edge validar -> panel : "Correctas" directo
edge panel -> validar "Volver" reversa
`);

  assert.equal(diagram.title, 'Flujo de acceso');
  assert.deepEqual(diagram.nodes.map(({ id, label, type, x, y }) => ({ id, label, type, x, y })), [
    { id: 'inicio', label: 'Inicio', type: 'start', x: 100, y: 180 },
    { id: 'validar', label: 'Validar credenciales', type: 'decision', x: 420, y: 180 },
    { id: 'panel', label: 'Panel principal', type: 'end', x: 760, y: 180 }
  ]);
  assert.deepEqual(diagram.edges.map(({ source, target, label, direction }) => ({ source, target, label, direction })), [
    { source: { nodeId: 'inicio', port: 'right' }, target: { nodeId: 'validar', port: 'left' }, label: 'Enviar datos', direction: 'forward' },
    { source: { nodeId: 'validar', port: 'right' }, target: { nodeId: 'panel', port: 'left' }, label: 'Correctas', direction: 'forward' },
    { source: { nodeId: 'panel', port: 'right' }, target: { nodeId: 'validar', port: 'left' }, label: 'Volver', direction: 'backward' }
  ]);
});

test('exporta una forma canónica que se puede volver a importar', async () => {
  const { parseDiagramText, serializeDiagram } = await language;
  const original = {
    title: 'Proceso "seguro"',
    nodes: [
      { id: 'entrada', label: 'Entrada con "comillas"', type: 'start', x: 120, y: 80 },
      { id: 'salida', label: 'Fin', type: 'end', x: 640, y: 320 }
    ],
    edges: [{ source: { nodeId: 'entrada', port: 'right' }, target: { nodeId: 'salida', port: 'left' }, label: 'Listo', direction: 'none' }]
  };
  const restored = parseDiagramText(serializeDiagram(original));

  assert.equal(restored.title, original.title);
  assert.deepEqual(restored.nodes, original.nodes);
  assert.deepEqual(restored.edges[0], { id: 'edge-1', ...original.edges[0] });
});

test('señala errores con la línea donde aparece el problema', async () => {
  const { DiagramSyntaxError, parseDiagramText } = await language;
  assert.throws(
    () => parseDiagramText('diagram "Incompleto"\nnode uno "Uno"\nedge uno -> dos'),
    (error) => error instanceof DiagramSyntaxError && error.line === 3 && /no existe/.test(error.message)
  );
  assert.throws(
    () => parseDiagramText('node uno Uno'),
    (error) => error instanceof DiagramSyntaxError && error.line === 1 && /entre comillas/.test(error.message)
  );
});
