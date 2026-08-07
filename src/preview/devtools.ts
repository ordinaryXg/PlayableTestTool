/** Injected into preview: console mirror + FPS reporter. */
export function buildDevtoolsScript(): string {
  return `
(function(){
  var post = window.__pvPost;
  if (!post) {
    post = function(type, detail){
      try {
        parent.postMessage({ source: 'playable-validator-probe', type: type, detail: detail || {}, at: Date.now() }, '*');
      } catch (e) {}
    };
  }

  function stringify(v){
    try {
      if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
      if (typeof v === 'string') return v;
      if (typeof v === 'undefined') return 'undefined';
      if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
      return JSON.stringify(v);
    } catch (e) {
      try { return String(v); } catch (e2) { return '[Unserializable]'; }
    }
  }

  function emitConsole(level, args){
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(stringify(args[i]));
    try {
      post('console', { level: level, message: parts.join(' ') });
    } catch (e) {}
  }

  ['log','info','warn','error','debug'].forEach(function(level){
    try {
      var orig = console[level] ? console[level].bind(console) : function(){};
      console[level] = function(){
        emitConsole(level, arguments);
        return orig.apply(console, arguments);
      };
    } catch (e) {}
  });

  window.addEventListener('error', function(ev){
    var msg = (ev && ev.message) ? ev.message : 'Script error';
    if (ev && ev.filename) msg += ' @ ' + ev.filename + ':' + (ev.lineno || 0);
    emitConsole('error', [msg]);
  });
  window.addEventListener('unhandledrejection', function(ev){
    emitConsole('error', ['UnhandledRejection', ev && ev.reason]);
  });

  function readHeap(){
    try {
      var mem = performance.memory;
      if (!mem) return null;
      return {
        usedMB: Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10,
        limitMB: Math.round((mem.jsHeapSizeLimit / 1048576) * 10) / 10
      };
    } catch (e) { return null; }
  }

  var last = performance.now();
  var frames = 0;
  var fps = 0;
  function tick(now){
    frames++;
    if (now - last >= 500) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
      var heap = readHeap();
      try {
        post('fps', {
          fps: fps,
          heapUsedMB: heap && heap.usedMB,
          heapLimitMB: heap && heap.limitMB
        });
      } catch (e) {}
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
`;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLine {
  id: number;
  level: ConsoleLevel | string;
  message: string;
  at: number;
}

export interface FpsStats {
  fps: number;
  heapUsedMB?: number;
  heapLimitMB?: number;
}
