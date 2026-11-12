/**
 * Test helpers: the app's scripts are plain browser globals (no modules), so we
 * evaluate them in a vm context with a minimal DOM stub, in the same order as index.html.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');

function elementStub() {
  const classes = new Set();
  const attrs = {};
  const el = {
    // Real enough to inspect: tests can assert which classes / attributes the app set
    classList: {
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        on ? classes.add(name) : classes.delete(name);
        return on;
      },
      add(...names) { names.forEach(n => classes.add(n)); },
      remove(...names) { names.forEach(n => classes.delete(n)); },
      contains: (name) => classes.has(name),
    },
    attrs,
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute: (name) => attrs[name],
    style: {},
    querySelector: () => null,
    addEventListener() {},
    appendChild() {},
    replaceChildren() {},
  };
  return el;
}

/**
 * Create a context and load the given js files (names without ".js") into it.
 * Returns { ctx, get(name) } where get() reads a top-level const such as XIANGQI.
 */
function loadContext(files, extraGlobals = {}) {
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    Math, Date, Promise,
    navigator: {},
    document: {
      getElementById: () => elementStub(),
      createElement: () => elementStub(),
      querySelector: () => elementStub(),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    addEventListener() {},
    ...extraGlobals,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(JS_DIR, `${f}.js`), 'utf8');
    vm.runInContext(code, ctx, { filename: `${f}.js` });
  }
  return { ctx, get: (name) => vm.runInContext(name, ctx) };
}

/** Rules module only (pure logic, no DOM). */
function loadXiangqi() {
  return loadContext(['xiangqi']).get('XIANGQI');
}

/** Standard perft: count leaf nodes of the legal-move tree. */
function perft(X, board, turn, depth) {
  if (depth === 0) return 1;
  let n = 0;
  const next = turn === 'red' ? 'black' : 'red';
  for (const m of X.getLegalMoves(board, turn)) {
    n += perft(X, X.applyMove(board, m.fromRow, m.fromCol, m.toRow, m.toCol), next, depth - 1);
  }
  return n;
}

module.exports = { loadContext, loadXiangqi, perft, elementStub };
