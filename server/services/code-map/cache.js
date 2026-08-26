const fs = require('node:fs');

const CACHE_VERSION = 'code-map-v1';

function createAnalysisCache({ maxEntries = 3000 } = {}) {
  const entries = new Map();
  let hits = 0;
  let misses = 0;

  function trim() {
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  function get(file, analyzer) {
    const key = `${CACHE_VERSION}:${file.absolutePath}:${file.size}:${file.mtimeMs}:${file.language}`;
    const cached = entries.get(key);
    if (cached) {
      hits += 1;
      return { ...cached, cached: true };
    }
    misses += 1;
    try {
      const content = fs.readFileSync(file.absolutePath, 'utf8');
      const result = analyzer(content, { filePath: file.path, language: file.language });
      const value = { ...result, cached: false };
      entries.set(key, value);
      trim();
      return value;
    } catch (error) {
      return {
        language: file.language,
        symbols: [],
        imports: [],
        exports: [],
        calls: [],
        extendsRelations: [],
        references: [],
        warnings: [{ line: 1, message: `No se pudo analizar el fichero: ${error.message}` }],
        cached: false
      };
    }
  }

  function clear() {
    entries.clear();
    hits = 0;
    misses = 0;
  }

  function stats() { return { entries: entries.size, hits, misses }; }

  return { get, clear, stats };
}

const sharedCache = createAnalysisCache();

module.exports = { CACHE_VERSION, createAnalysisCache, sharedCache };
