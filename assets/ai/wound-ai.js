/* DiaAI: on-device wound outlining with a Segment Anything model (MobileSAM, ONNX).
   Photos never leave the device. Only the model files are downloaded, once, then cached.

   Use:  DiaAI.outline(imageElement, xPixel, yPixel, onStatus)  ->  { poly, score, coverage }
   poly is a list of {x, y} in the image's own pixel coordinates.

   Model files (about 45 MB together) are looked for in this order:
     1. <site root>/models/<file>      (put them there to self-host)
     2. Hugging Face (Acly/MobileSAM)
   To point somewhere else, set window.DIA_AI_MODELS = { encoder: [url], decoder: [url] } first. */
(function () {
  'use strict';

  var SCRIPT = (document.currentScript && document.currentScript.src) || location.href;
  var ASSETS = new URL('../', SCRIPT).href;   // .../assets/
  var SITE = new URL('../../', SCRIPT).href;  // site root
  var N = 1024;                               // the model works on a 1024 x 1024 square
  var HF = 'https://huggingface.co/Acly/MobileSAM/resolve/main/';
  var FILES = { encoder: 'mobile_sam_image_encoder.onnx', decoder: 'sam_mask_decoder_multi.onnx' };
  var CACHE = 'diascreen-models-v1';
  var MAX_POINTS = 90;

  var state = { ort: null, enc: null, dec: null, ready: null, src: null, emb: null };

  function say(cb, msg) { try { if (cb) cb(msg); } catch (e) {} }

  function urlsFor(kind) {
    var cfg = window.DIA_AI_MODELS;
    if (cfg && cfg[kind]) return [].concat(cfg[kind]);
    return [SITE + 'models/' + FILES[kind], HF + FILES[kind]];
  }

  /* ---------- runtime and model loading ---------- */
  function loadOrt() {
    if (window.ort) return Promise.resolve(window.ort);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ASSETS + 'vendor/ort/ort.wasm.min.js';
      s.onload = function () {
        window.ort.env.wasm.wasmPaths = ASSETS + 'vendor/ort/';
        window.ort.env.wasm.numThreads = 1;   // GitHub Pages cannot send the headers threads need
        window.ort.env.wasm.proxy = false;
        resolve(window.ort);
      };
      s.onerror = function () { reject(new Error('Could not load the AI runtime.')); };
      document.head.appendChild(s);
    });
  }

  async function readWithProgress(res, label, cb) {
    var total = +res.headers.get('content-length') || 0;
    if (!res.body || !total) return res.arrayBuffer();
    var reader = res.body.getReader(), chunks = [], got = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      say(cb, 'Downloading ' + label + ': ' + Math.round(got / total * 100) + '%');
    }
    var out = new Uint8Array(got), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out.buffer;
  }

  async function getModel(kind, cb) {
    var urls = urlsFor(kind), cache = null, label = kind + ' model';
    try { cache = await caches.open(CACHE); } catch (e) {}
    if (cache) {
      for (var i = 0; i < urls.length; i++) {
        var hit = await cache.match(urls[i]);
        if (hit) return { buf: await hit.arrayBuffer(), url: urls[i] };
      }
    }
    var lastErr = null;
    for (var j = 0; j < urls.length; j++) {
      try {
        say(cb, 'Downloading ' + label + ' (one time only)');
        var res = await fetch(urls[j]);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('not a model file');
        var buf = await readWithProgress(res, label, cb);
        if (cache) { try { await cache.put(urls[j], new Response(buf.slice(0))); } catch (e) {} }
        return { buf: buf, url: urls[j] };
      } catch (e) { lastErr = e; }
    }
    throw new Error('Could not download the ' + label + ' (' + (lastErr && lastErr.message) + ').');
  }

  async function forget(urls) {
    try { var c = await caches.open(CACHE); for (var i = 0; i < urls.length; i++) await c.delete(urls[i]); } catch (e) {}
  }

  function ensure(cb) {
    if (state.ready) return state.ready;
    state.ready = (async function () {
      say(cb, 'Starting AI runtime');
      var ort = await loadOrt();
      state.ort = ort;
      var eb = await getModel('encoder', cb);
      var db = await getModel('decoder', cb);
      say(cb, 'Preparing the model');
      var opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      try {
        state.enc = await ort.InferenceSession.create(new Uint8Array(eb.buf), opts);
        state.dec = await ort.InferenceSession.create(new Uint8Array(db.buf), opts);
      } catch (e) {
        await forget([eb.url, db.url]);   // do not keep a damaged file in the cache
        throw new Error('The model file could not be read. It may be damaged or the wrong file. Try again.');
      }
      var need = ['image_embeddings', 'point_coords', 'point_labels', 'mask_input', 'has_mask_input', 'orig_im_size'];
      var missing = need.filter(function (n) { return state.dec.inputNames.indexOf(n) < 0; });
      if (state.enc.inputNames.length !== 1 || missing.length) {
        await forget([eb.url, db.url]);
        throw new Error('These model files are not in the expected MobileSAM format.');
      }
    })().catch(function (e) { state.ready = null; throw e; });
    return state.ready;
  }

  /* ---------- image to model input ---------- */
  function layout(w, h) {
    var s = N / Math.max(w, h), dw = Math.round(w * s), dh = Math.round(h * s);
    return { s: s, dw: dw, dh: dh, ox: Math.floor((N - dw) / 2), oy: Math.floor((N - dh) / 2) };
  }

  function toTensor(img, L) {
    var c = document.createElement('canvas');
    c.width = N; c.height = N;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000';
    x.fillRect(0, 0, N, N);
    x.drawImage(img, L.ox, L.oy, L.dw, L.dh);
    var d = x.getImageData(0, 0, N, N).data, out = new Float32Array(N * N * 3);
    for (var i = 0, p = 0; i < N * N; i++, p += 3) {
      out[p] = d[i * 4]; out[p + 1] = d[i * 4 + 1]; out[p + 2] = d[i * 4 + 2];   // 0..255, HWC
    }
    return new state.ort.Tensor('float32', out, [N, N, 3]);
  }

  async function encode(img, L, src, cb) {
    if (state.src === src && state.emb) return;
    say(cb, 'Reading the photo (this can take several seconds on a phone)');
    var t = toTensor(img, L);
    var o = {};
    o[state.enc.inputNames[0]] = t;
    var r = await state.enc.run(o);
    state.emb = r[state.enc.outputNames[0]];
    state.src = src;
  }

  async function decode(px, py) {
    var T = state.ort.Tensor;
    var r = await state.dec.run({
      image_embeddings: state.emb,
      point_coords: new T('float32', [px, py], [1, 1, 2]),
      point_labels: new T('float32', [1], [1, 1]),
      mask_input: new T('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new T('float32', [0], [1]),
      orig_im_size: new T('float32', [N, N], [2])
    });
    var masks = r.masks || r[state.dec.outputNames[0]];
    var ious = r.iou_predictions || r[state.dec.outputNames[1]];
    var iou = Array.prototype.slice.call(ious.data), best = 0;
    for (var i = 1; i < iou.length; i++) if (iou[i] > iou[best]) best = i;
    var H = masks.dims[2], W = masks.dims[3];
    return { plane: masks.data.subarray(best * H * W, (best + 1) * H * W), W: W, H: H, score: iou[best] };
  }

  /* ---------- mask to outline ---------- */
  function component(plane, W, H, sx, sy) {
    var bin = new Uint8Array(W * H), i;
    for (i = 0; i < bin.length; i++) bin[i] = plane[i] > 0 ? 1 : 0;
    var seed = -1;
    if (bin[sy * W + sx]) seed = sy * W + sx;
    else {
      for (var r = 1; r <= 40 && seed < 0; r++) {   // nearest mask pixel to the tap
        for (var dy = -r; dy <= r && seed < 0; dy++) for (var dx = -r; dx <= r; dx++) {
          var X = sx + dx, Y = sy + dy;
          if (X >= 0 && Y >= 0 && X < W && Y < H && bin[Y * W + X]) { seed = Y * W + X; break; }
        }
      }
    }
    if (seed < 0) return null;
    var comp = new Uint8Array(W * H), stack = [seed], n = 0;
    comp[seed] = 1;
    while (stack.length) {
      var p = stack.pop(), x = p % W, y = (p - x) / W;
      n++;
      if (x > 0 && bin[p - 1] && !comp[p - 1]) { comp[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && bin[p + 1] && !comp[p + 1]) { comp[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && bin[p - W] && !comp[p - W]) { comp[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && bin[p + W] && !comp[p + W]) { comp[p + W] = 1; stack.push(p + W); }
    }
    return { comp: comp, count: n };
  }

  var DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];   // clockwise from west

  function trace(comp, W, H) {
    var s = comp.indexOf(1);
    if (s < 0) return [];
    var sx = s % W, sy = (s - sx) / W;
    var inside = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && comp[y * W + x] === 1; };
    var pts = [[sx, sy]], bx = sx, by = sy, cx = sx - 1, cy = sy, guard = 0;
    for (;;) {
      var dir = 0;
      for (var k = 0; k < 8; k++) if (bx + DIRS[k][0] === cx && by + DIRS[k][1] === cy) { dir = k; break; }
      var moved = false;
      for (var i = 1; i <= 8; i++) {
        var d = (dir + i) % 8, nx = bx + DIRS[d][0], ny = by + DIRS[d][1];
        if (inside(nx, ny)) {
          var pd = (d + 7) % 8;
          cx = bx + DIRS[pd][0]; cy = by + DIRS[pd][1];
          bx = nx; by = ny; moved = true; break;
        }
      }
      if (!moved) break;                                   // single pixel
      if (bx === sx && by === sy) break;                   // closed the loop
      pts.push([bx, by]);
      if (++guard > 400000) break;
    }
    return pts;
  }

  function simplify(pts, eps) {   // Douglas-Peucker on a closed loop
    var n = pts.length;
    if (n < 4) return pts;
    var far = 0, best = -1;
    for (var i = 1; i < n; i++) {
      var d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > best) { best = d; far = i; }
    }
    var keep = new Uint8Array(n);
    keep[0] = 1; keep[far] = 1;
    var stack = [[0, far], [far, n]];   // second span closes back to index 0
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var A = pts[a], B = pts[b % n], dx = B[0] - A[0], dy = B[1] - A[1];
      var len = Math.hypot(dx, dy) || 1, maxD = -1, idx = -1;
      for (var j = a + 1; j < b; j++) {
        var dd = Math.abs(dy * pts[j][0] - dx * pts[j][1] + B[0] * A[1] - B[1] * A[0]) / len;
        if (dd > maxD) { maxD = dd; idx = j; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    var out = [];
    for (var m = 0; m < n; m++) if (keep[m]) out.push(pts[m]);
    return out;
  }

  /* ---------- public ---------- */
  async function outline(img, x, y, cb) {
    await ensure(cb);
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var L = layout(w, h);
    await encode(img, L, img.src, cb);
    say(cb, 'Outlining the wound');
    var px = x * L.s + L.ox, py = y * L.s + L.oy;
    var m = await decode(px, py);
    var c = component(m.plane, m.W, m.H, Math.min(m.W - 1, Math.max(0, Math.round(px))), Math.min(m.H - 1, Math.max(0, Math.round(py))));
    if (!c) throw new Error('No wound found at that spot. Tap nearer the middle of the wound.');
    var contour = trace(c.comp, m.W, m.H), eps = 1.5, pts = simplify(contour, eps);
    while (pts.length > MAX_POINTS && eps < 40) { eps *= 1.6; pts = simplify(contour, eps); }
    var poly = pts.map(function (p) {
      return { x: Math.min(w, Math.max(0, (p[0] - L.ox) / L.s)), y: Math.min(h, Math.max(0, (p[1] - L.oy) / L.s)) };
    });
    if (poly.length < 3) throw new Error('The outline was too small. Tap a different spot inside the wound.');
    var coverage = c.count / (L.dw * L.dh);
    return { poly: poly, score: m.score, coverage: coverage };
  }

  window.DiaAI = {
    model: 'MobileSAM (ONNX)',
    supported: function () { return typeof WebAssembly === 'object'; },
    outline: outline,
    reset: function () { state.src = null; state.emb = null; }
  };
})();
