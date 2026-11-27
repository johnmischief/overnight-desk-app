// Canvas charts for the desk app. DPR aware. No libraries, no data of their own.
(function () {
  "use strict";
  var GREEN = "#00d35a", RED = "#ff453a", BLUE = "#0a84ff", ORANGE = "#ff9f0a";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function fit(canvas) {
    var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    return { c: c, w: w, h: h };
  }

  function pill(c, x, y, text, color) {
    c.font = "600 11px -apple-system, system-ui, sans-serif";
    var tw = c.measureText(text).width, w = tw + 14, h = 20;
    return { x: x - w / 2, y: y - h, w: w, h: h, text: text, color: color };
  }
  function drawPill(c, p) {
    c.fillStyle = "rgba(28,28,30,0.96)"; round(c, p.x, p.y, p.w, p.h, 10); c.fill();
    c.strokeStyle = p.color; c.globalAlpha = 0.9; c.lineWidth = 1; round(c, p.x + .5, p.y + .5, p.w - 1, p.h - 1, 10); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = p.color; c.textBaseline = "middle"; c.textAlign = "center"; c.fillText(p.text, p.x + p.w / 2, p.y + p.h / 2 + .5);
  }
  function round(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // opts: {points:[{ts,v}], marks:[{ts,text,color}], start:number}. Returns false when there is nothing to draw.
  // A new last point slides in over 250 ms (not with prefers-reduced-motion).
  function line(canvas, opts) {
    var pts = (opts.points || []).filter(function (p) { return p && p.v != null && p.ts != null; });
    var prev = canvas._last, key = pts.length ? pts[pts.length - 1].ts + ":" + pts[pts.length - 1].v : "";
    canvas._last = pts.length ? pts[pts.length - 1] : null;
    var cb = fit(canvas);
    if (pts.length < 2) return false;
    var animate = !reduce && prev && canvas._key && canvas._key !== key && prev.ts < pts[pts.length - 1].ts;
    canvas._key = key;
    var t0 = performance.now();
    function frame(now) {
      var k = animate ? Math.min(1, (now - t0) / 250) : 1, e = 1 - Math.pow(1 - k, 3);
      var use = pts.slice();
      if (animate && k < 1) {
        var L = pts[pts.length - 1];
        use[use.length - 1] = { ts: prev.ts + (L.ts - prev.ts) * e, v: prev.v + (L.v - prev.v) * e };
      }
      paint(canvas, opts, use);
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return true;
  }

  function paint(canvas, opts, pts) {
    var cb = fit(canvas), c = cb.c, W = cb.w, H = cb.h;
    var padL = 6, padR = 10, padT = 54, padB = 14;
    var t0 = pts[0].ts, t1 = pts[pts.length - 1].ts, span = Math.max(1, t1 - t0);
    var min = Infinity, max = -Infinity;
    pts.forEach(function (p) { min = Math.min(min, p.v); max = Math.max(max, p.v); });
    var start = opts.start != null ? opts.start : pts[0].v;
    min = Math.min(min, start); max = Math.max(max, start);
    var pad = (max - min) * 0.08 || Math.abs(max) * 0.002 || 1; min -= pad; max += pad;
    var X = function (ts) { return padL + (ts - t0) / span * (W - padL - padR); };
    var Y = function (v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); };
    // gradient under the line
    var g = c.createLinearGradient(0, padT, 0, H - padB);
    g.addColorStop(0, "rgba(0,211,90,0.26)"); g.addColorStop(1, "rgba(0,211,90,0)");
    c.beginPath(); pts.forEach(function (p, i) { i ? c.lineTo(X(p.ts), Y(p.v)) : c.moveTo(X(p.ts), Y(p.v)); });
    c.lineTo(X(t1), H - padB); c.lineTo(X(t0), H - padB); c.closePath(); c.fillStyle = g; c.fill();
    // dashed start line
    c.setLineDash([4, 4]); c.strokeStyle = "rgba(235,235,245,0.3)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, Y(start)); c.lineTo(W - padR, Y(start)); c.stroke(); c.setLineDash([]);
    // the line
    c.beginPath(); pts.forEach(function (p, i) { i ? c.lineTo(X(p.ts), Y(p.v)) : c.moveTo(X(p.ts), Y(p.v)); });
    c.strokeStyle = GREEN; c.lineWidth = 2.5; c.lineJoin = "round"; c.lineCap = "round"; c.stroke();
    var L = pts[pts.length - 1]; c.beginPath(); c.arc(X(L.ts), Y(L.v), 4, 0, 7); c.fillStyle = GREEN; c.fill();
    // marks above the line; a later mark that would overlap moves up one row
    var placed = [];
    (opts.marks || []).filter(function (m) { return m.ts >= t0 && m.ts <= t1 + 1; }).sort(function (a, b) { return a.ts - b.ts; }).forEach(function (m) {
      var x = Math.min(W - 40, Math.max(40, X(m.ts)));
      var near = pts.reduce(function (b, p) { return Math.abs(p.ts - m.ts) < Math.abs(b.ts - m.ts) ? p : b; }, pts[0]);
      var row = 0, p;
      for (;;) {
        p = pill(c, x, Y(near.v) - 12 - row * 24, m.text, m.color);
        var hit = placed.some(function (q) { return p.x < q.x + q.w + 3 && p.x + p.w + 3 > q.x && p.y < q.y + q.h + 2 && p.y + p.h + 2 > q.y; });
        if (!hit || p.y < 2) break; row++;
      }
      placed.push(p);
      c.strokeStyle = "rgba(235,235,245,0.3)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x, p.y + p.h); c.lineTo(x, Y(near.v) - 4); c.stroke();
      drawPill(c, p);
    });
  }

  // candles: [{t,o,h,l,c}], exit: price or null (orange dashed). Returns false when empty.
  function candles(canvas, opts) {
    var cs = (opts.candles || []).filter(function (k) { return k && k.o != null; });
    var cb = fit(canvas), c = cb.c, W = cb.w, H = cb.h;
    if (!cs.length) return false;
    var padL = 6, padR = 52, padT = 12, padB = 18;
    var lo = Infinity, hi = -Infinity;
    cs.forEach(function (k) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); });
    if (opts.exit != null) { lo = Math.min(lo, opts.exit); hi = Math.max(hi, opts.exit); }
    var pad = (hi - lo) * 0.1 || hi * 0.05 || 1; lo -= pad; hi += pad;
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); };
    var n = Math.max(cs.length, 20), bw = (W - padL - padR) / n, bodyW = Math.max(2, bw * 0.62);
    cs.forEach(function (k, i) {
      var x = padL + (i + 0.5) * bw, up = k.c >= k.o, col = up ? GREEN : RED;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x, Y(k.h)); c.lineTo(x, Y(k.l)); c.stroke();
      var y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      c.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1.5, y2 - y1));
    });
    if (opts.exit != null) {
      c.setLineDash([5, 4]); c.strokeStyle = ORANGE; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(padL, Y(opts.exit)); c.lineTo(W - padR + 4, Y(opts.exit)); c.stroke(); c.setLineDash([]);
      c.fillStyle = ORANGE; c.font = "600 11px -apple-system, system-ui, sans-serif"; c.textAlign = "right"; c.textBaseline = "bottom";
      c.fillText("exit", W - 4, Y(opts.exit) - 2);
    }
    return true;
  }

  // score ring 0-100, green from 70
  function ring(canvas, score, size) {
    var dpr = window.devicePixelRatio || 1, s = size || 64;
    canvas.width = s * dpr; canvas.height = s * dpr; canvas.style.width = s + "px"; canvas.style.height = s + "px";
    var c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, s, s);
    var r = s / 2 - 5; c.lineWidth = 6; c.lineCap = "round";
    c.strokeStyle = "#2c2c2e"; c.beginPath(); c.arc(s / 2, s / 2, r, 0, Math.PI * 2); c.stroke();
    if (score == null) return;
    var v = Math.max(0, Math.min(100, score)) / 100;
    c.strokeStyle = score >= 70 ? GREEN : ORANGE; c.beginPath(); c.arc(s / 2, s / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v); c.stroke();
  }

  window.DeskChart = { line: line, candles: candles, ring: ring };
})();
