// engine/worker.js
// Fairy-Stockfish Web Worker bridge

// Resolve asset URLs relative to this worker so the app also works when hosted in a sub-folder.
const BASE = self.location.href.replace(/[^/]*(\?.*)?$/, '');

importScripts(BASE + 'stockfish.js');

let engineInstance = null;
const messageQueue = [];

Stockfish({
  mainScriptUrlOrBlob: BASE + 'stockfish.js',
  locateFile: function(path, prefix) {
    if (path && path.endsWith('.wasm')) {
      return BASE + 'stockfish.wasm';
    }
    if (path && path.endsWith('.worker.js')) {
      return BASE + 'stockfish.worker.js';
    }
    return (prefix || BASE) + path;
  }
}).then(function(sf) {
  engineInstance = sf;
  sf.addMessageListener(function(line) {
    self.postMessage(line);
  });

  // Drain queued messages
  while (messageQueue.length > 0) {
    const cmd = messageQueue.shift();
    sf.postMessage(cmd);
  }
}).catch(function(err) {
  console.error('Failed to load Fairy-Stockfish WASM:', err);
  self.postMessage('ERROR: ' + (err && err.message ? err.message : String(err)));
});

self.onmessage = function(e) {
  const cmd = e.data;
  if (engineInstance) {
    engineInstance.postMessage(cmd);
  } else {
    messageQueue.push(cmd);
  }
};
