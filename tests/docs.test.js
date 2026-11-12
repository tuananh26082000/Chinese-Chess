const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const doc = read('docs/FEATURES.md');

// The names a module exposes: the keys of its final `return { ... };`
function exportsOf(file) {
  const src = read(file);
  const at = src.lastIndexOf('return {');
  assert.ok(at >= 0, `${file} has a return block`);
  const block = src.slice(at + 'return {'.length, src.indexOf('};', at));
  const names = new Set();
  for (const line of block.split('\n')) {
    if (!/^ {4}\S/.test(line) && !/^\s*\w[\w\s,]*$/.test(block.split('\n')[0] || '')) continue;   // top-level items only
    for (const part of line.split(',')) {
      const m = part.trim().match(/^([A-Za-z_]\w*)\s*(?::|$)/);
      if (m) names.add(m[1]);
    }
  }
  // single-line form: return { a, b, c };
  if (!block.includes('\n')) block.split(',').forEach(p => { const m = p.trim().match(/^([A-Za-z_]\w*)/); if (m) names.add(m[1]); });
  return names;
}

const MODULES = {
  Game: 'js/main.js', BoardEditor: 'js/editor.js', Engine: 'js/engine.js',
  XIANGQI: 'js/xiangqi.js', Geometry: 'js/geometry.js', Analyzer: 'js/analyzer.js', UI: 'js/ui.js',
};

test('the export parser finds the real API (guards this test itself)', () => {
  assert.ok(exportsOf('js/main.js').has('setMode'));
  assert.ok(exportsOf('js/main.js').has('getState'));
  assert.ok(exportsOf('js/engine.js').has('pickMove'));
  assert.ok(exportsOf('js/geometry.js').has('evalBarSplit'));
  assert.ok(exportsOf('js/ui.js').has('setAnalysisVariations'));
  assert.ok(exportsOf('js/editor.js').has('startAnalysis'));
  assert.ok(!exportsOf('js/main.js').has('executeMoveXYZ'));
});

test('every `Module.function` named in docs/FEATURES.md still exists', () => {
  const exported = Object.fromEntries(Object.entries(MODULES).map(([name, file]) => [name, exportsOf(file)]));
  const stale = [];
  for (const m of doc.matchAll(/`(Game|BoardEditor|Engine|XIANGQI|Geometry|Analyzer|UI)\.(\w+)/g)) {
    if (!exported[m[1]].has(m[2])) stale.push(`${m[1]}.${m[2]}`);
  }
  assert.deepEqual([...new Set(stale)], [],
    'docs mention API that no longer exists (or is not exported: write internal helpers without the Module. prefix)');
});

test('every script and every test file is described in docs/FEATURES.md', () => {
  const missing = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
    if (!doc.includes(`js/${f}`)) missing.push(`js/${f}`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js'))) {
    if (!doc.includes(f)) missing.push(`tests/${f}`);
  }
  for (const f of ['sw.js', 'engine/', '_headers', 'server.py']) if (!doc.includes(f)) missing.push(f);
  assert.deepEqual(missing, [], 'add them to the architecture table / test map');
});

test('relative links in the docs and CLAUDE.md point at files that exist', () => {
  const broken = [];
  for (const file of ['docs/FEATURES.md', 'docs/AI_GUIDELINES.md', 'CLAUDE.md']) {
    const dir = path.dirname(file);
    for (const m of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      if (!fs.existsSync(path.join(ROOT, dir, m[1]))) broken.push(`${file} -> ${m[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('CLAUDE.md tells readers to start with the feature guide', () => {
  assert.match(read('CLAUDE.md'), /docs\/FEATURES\.md/);
});

test('the guide documents the rules that are easiest to break', () => {
  // These are product decisions made by the user; losing them from the docs would invite regressions.
  assert.match(doc, /chọn chế độ = reset/i);
  assert.match(doc, /mức 10.*margin 0|margin 0.*mức 10/s);
  assert.match(doc, /tự do hoàn toàn|Không.*chặn.*không.*cảnh báo/is);
  assert.match(doc, /1 nước|một nước/);
});
