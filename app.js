// Overnight Desk · the iPhone app (STEP 10). Static page: all data comes at runtime from a secret gist.
// The gist id is the secret: it arrives once as  #d=<id>, is saved in this browser's localStorage and is then removed
// from the address bar. It is never part of this repo. The app holds no desk token and builds no FOMO link: every
// "Open on FOMO" is the exact coin_url / profile_url / signup_url the desk published (made by links.py), never rewritten.
// Plan B: the phone only READS. Anything that would change the desk is shown, marked "via Telegram", and opens a sheet
// with the Telegram command to send (STEP 11).
(function () {
  "use strict";
  var KEY = "desk.gist", SEEN = "desk.bell";
  var POLL_MS = 15000, SLOW_MS = 55000, STALE_S = 150;
  var BOTS = ["scanner", "analyst", "brain", "executor", "risk"];
  var COLOR = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  var NAME = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };

  var D = {};                              // the published files, by name
  var net = { ok: true, lastGood: 0, nextAt: 0, slowAt: 0, screenTs: null, apiAt: 0, started: false };
  var gist = null, cur = null, offEls = [], timer = null, tickBusy = false;

  // ------------------------------------------------------------ tiny DOM helper
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function svg(path) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = path; return s; }
  var ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>'
  };

  // ------------------------------------------------------------ formatting (never a made-up number: null -> "n/a")
  function money(v, d) { if (v == null || isNaN(v)) return "n/a"; var n = Number(v); return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function sgnMoney(v) { if (v == null || isNaN(v)) return "n/a"; return (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toFixed(2); }
  function sgnPct(v, d) { if (v == null || isNaN(v)) return "n/a"; return (v >= 0 ? "+" : "") + Number(v).toFixed(d == null ? 2 : d) + "%"; }
  function price(v) {
    if (v == null || isNaN(v)) return "n/a";
    v = Number(v); if (v >= 1) return "$" + v.toFixed(2); if (v >= 0.01) return "$" + v.toFixed(4); if (v <= 0) return "$0";
    var z = -Math.floor(Math.log10(v)) - 1;                    // zeros after the decimal point
    return z <= 7 ? "$" + v.toFixed(z + 3) : "$" + v.toExponential(2).replace("e-", "e-");
  }
  function compact(v) { if (v == null || isNaN(v)) return "n/a"; v = Number(v); var a = Math.abs(v); return a >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0); }
  function clock(ts) { return ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "n/a"; }
  function ageTxt(mins) { if (mins == null) return null; return mins < 60 ? Math.round(mins) + "m old" : mins < 2880 ? Math.round(mins / 60) + "h old" : Math.round(mins / 1440) + "d old"; }
  function shortMint(m) { return m ? m.slice(0, 6) + "…" + m.slice(-4) : ""; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function now() { return Date.now() / 1000; }
  function isPaper() { return !D.state || D.state.mode !== "LIVE"; }

  // an "Open on FOMO" link: the href is the published URL, untouched
  function fomo(url, label, cls) {
    if (!url) return null;
    return h("a", { class: "fomo " + (cls || ""), href: url, target: "_blank", rel: "noopener noreferrer", text: label || "Open on FOMO", onclick: function (e) { e.stopPropagation(); } });
  }

  // ------------------------------------------------------------ toast, sheet, copy, share
  var toastT = null;
  function toast(msg) {
    var t = document.querySelector(".toast"); if (t) t.remove();
    t = h("div", { class: "toast", text: msg, role: "status" }); document.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, 1800);
  }
  function copy(text, msg) {
    function done() { toast(msg || "Copied"); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); } else fallback();
    function fallback() {
      var ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed"); } ta.remove();
    }
  }
  function share(url) {
    if (!url) return;
    if (navigator.share) navigator.share({ url: url, title: "FOMO" }).catch(function () {});
    else copy(url, "Link copied");
  }
  function openSheet(nodes) {
    var s = $("sheet"); s.textContent = ""; s.appendChild(h("div", { class: "grab" }));
    nodes.forEach(function (n) { s.appendChild(n); });
    $("scrim").classList.add("on"); s.classList.add("on");
  }
  function closeSheet() { $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); }
  $("scrim").addEventListener("click", closeSheet);
  // every write control: shown, marked, and routed to Telegram
  function botName() { var t = D.account && D.account.telegram; return (t && t.bot) || "misch_desk_bot"; }
  function tgSheet(title, command, extra) {
    var nodes = [h("h3", { text: title }),
      h("div", { class: "note", text: "The phone can only read the desk right now (Plan B), so this goes through Telegram. Send the command below to @" + botName() + "; it answers there." })];
    if (command) {
      nodes.push(h("div", { class: "cmd", text: command })); nodes.push(h("button", { class: "btn blue", text: "Copy command", onclick: function () { copy(command); } }));
      nodes.push(h("button", { class: "btn", style: "margin-top:10px", text: "Open Telegram", onclick: function () { window.open("https://t.me/" + botName(), "_blank", "noopener"); } }));
    }
    if (extra) nodes.push(h("div", { class: "note", style: "margin-top:10px", text: extra }));
    nodes.push(h("button", { class: "btn", style: "margin-top:10px", text: "Close", onclick: closeSheet }));
    openSheet(nodes);
  }
  function tgTag(text) { return h("span", { class: "tgtag", text: text || "via Telegram" }); }

  // ------------------------------------------------------------ odometer (digits roll 600ms ease-out, 30ms stagger)
  function Odo(host) { this.host = host; this.text = null; this.cols = []; }
  Odo.prototype.set = function (text) {
    if (this.text === text) return;
    var H = this.host, me = this, rebuild = this.text == null || this.text.length !== text.length;
    if (rebuild) {
      H.textContent = ""; this.cols = [];
      text.split("").forEach(function (ch, i) {
        if (/\d/.test(ch)) {
          var strip = h("span", { class: "odo-strip" });
          for (var d = 0; d < 10; d++) strip.appendChild(h("i", { text: String(d) }));
          strip.style.setProperty("--d", ch); strip.style.setProperty("--i", 0);
          H.appendChild(h("span", { class: "odo-d" }, [strip])); me.cols.push(strip);
        } else { H.appendChild(h("span", { class: "odo-c", text: ch })); me.cols.push(null); }
      });
      requestAnimationFrame(function () { requestAnimationFrame(function () { me.cols.forEach(function (s) { if (s && !reduce) s.classList.add("go"); }); }); });
    } else {
      var k = 0;
      text.split("").forEach(function (ch, i) {
        var s = me.cols[i];
        if (s && me.text[i] !== ch) { s.style.setProperty("--i", k++); s.style.setProperty("--d", ch); }
      });
    }
    H.setAttribute("aria-label", text); this.text = text;
  };

  // ------------------------------------------------------------ data
  function owner() { var m = location.hostname.match(/^([^.]+)\.github\.io$/i); return m ? m[1] : localStorage.getItem("desk.owner"); }
  function rawUrl(name) { return "https://gist.githubusercontent.com/" + owner() + "/" + gist + "/raw/" + name + ".json?t=" + Date.now(); }
  function getJson(name) {
    return fetch(rawUrl(name), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(name + " " + r.status); return r.json(); });
  }
  function viaApi() {   // one call, all files; 60/h/IP unauthenticated: only when the raw endpoint fails, at most once a minute
    if (Date.now() - net.apiAt < 60000) return Promise.reject(new Error("api cooldown"));
    net.apiAt = Date.now();
    return fetch("https://api.github.com/gists/" + gist, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("api " + r.status); return r.json(); })
      .then(function (g) { var o = {}; Object.keys(g.files || {}).forEach(function (f) { try { o[f.replace(/\.json$/, "")] = JSON.parse(g.files[f].content); } catch (e) {} }); if (!o.state) throw new Error("no state"); return o; });
  }
  function settle(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }

  function tick() {
    if (tickBusy || !gist) return; tickBusy = true;
    net.nextAt = Date.now() + POLL_MS;
    var names = ["state", "chart", "activity", "orders"];
    var slow = !net.slowAt || Date.now() - net.slowAt > SLOW_MS;
    if (slow) names = names.concat(["audits", "coins", "decisions", "account", "settings"]);
    Promise.all(names.map(function (n) { return settle(getJson(n)); })).then(function (rs) {
      var got = {}; names.forEach(function (n, i) { if (rs[i].ok) got[n] = rs[i].v; });
      if (got.state) return got;
      return viaApi();                                           // raw failed for state: try the one-call API
    }).then(function (got) {
      Object.keys(got).forEach(function (n) { D[n] = got[n]; });
      if (slow) net.slowAt = Date.now();
      net.ok = true; net.lastGood = Date.now();
      var st = D.state && D.state.screen;
      if (!st) { D.screen = null; net.screenTs = null; }
      else if (st.ts !== net.screenTs) {
        return settle(got.screen ? Promise.resolve(got.screen) : getJson("screen")).then(function (r) { if (r.ok) { D.screen = r.v; net.screenTs = st.ts; } });
      }
    }).catch(function () { net.ok = false; }).then(function () { tickBusy = false; refresh(); });
  }

  // ------------------------------------------------------------ the offline row (error state)
  function offlineText() {
    var stale = D.state && D.state.published_at && now() - D.state.published_at > STALE_S;
    if (net.ok && !stale) return null;
    var n = Math.max(0, Math.ceil((net.nextAt - Date.now()) / 1000));
    var last = D.state && D.state.published_at ? clock(D.state.published_at) : (net.lastGood ? clock(net.lastGood / 1000) : "never");
    return "Desk offline · retrying in " + n + "s · last update " + last;
  }
  function paintOffline() { var t = offlineText(); offEls.forEach(function (e) { e.hidden = !t; if (t) e.textContent = t; }); }
  function offlineRow() { var e = h("div", { class: "offline", role: "alert", hidden: true }); offEls.push(e); return e; }

  // ------------------------------------------------------------ shared pieces
  function sk(heights) { return h("div", { class: "page" }, heights.map(function (x) { return h("div", { class: "sk", style: "height:" + x + "px;margin-top:14px" }); })); }
  function pageNav(title, right) {
    return h("div", { class: "nav" }, [
      h("button", { class: "iconbtn", "aria-label": "Back", onclick: function () { if (history.length > 1) history.back(); else go("home"); } }, [svg(ICON.back)]),
      h("h1", { text: title || "" }), right || h("span", { style: "width:44px" })]);
  }
  function sym(it) { return it.symbol || (D.coins && D.coins.mints && D.coins.mints[it.mint] && D.coins.mints[it.mint].coin && D.coins.mints[it.mint].coin.symbol) || shortMint(it.mint); }
  function bookSym(mint) { var c = D.coins && D.coins.mints && D.coins.mints[mint]; return c && c.coin && c.coin.symbol || shortMint(mint); }
  function botStat(name) {
    var c = (D.state && D.state.cards || []).filter(function (x) { return x.name === name; })[0] || {};
    var b = (D.state && D.state.bots && D.state.bots[name]) || {};
    var beat = c.last_beat || b.last_beat, age = beat ? now() - beat : null;
    return { paused: !!c.paused, status: c.status || b.status, headline: c.headline, down: age == null || age > 120, b: b };
  }
  function tonight() { return (D.state && D.state.desk && D.state.desk.tonight) || {}; }
  function setting(k) { var s = D.settings && D.settings[k]; return s ? s.value : null; }
  function positions() { return (D.state && D.state.positions || []).filter(function (p) { return p.open !== false; }); }
  function decs(name) { return (D.decisions && D.decisions[name]) || []; }
  function lastOrder() { var it = (D.orders && D.orders.items) || []; return it[0] || null; }
  function runningCount() { return BOTS.filter(function (n) { var s = botStat(n); return !s.paused && !s.down; }).length; }

  function checkRow(chk) {
    var box = h("span", { class: "checks" });
    [["screen", "screen"], ["api", "api"], ["chain", "chain"]].forEach(function (p) {
      var v = chk ? chk[p[0]] : null;
      box.appendChild(h("span", { title: v == null ? "n/a" : v ? "ok" : "failed" }, [h("i", { class: "ck " + (v === true ? "ok" : v === false ? "bad" : ""), text: v === true ? "✓" : v === false ? "✕" : "–" }), p[1]]));
    });
    return box;
  }

  // ------------------------------------------------------------ the live screen card
  function LiveCard() {
    var a = h("img", { alt: "", decoding: "async" }), b = h("img", { alt: "", decoding: "async" });
    var dot = h("i", { class: "dot" }), lbl = h("span", { text: "No frame yet" });
    var tl = h("div", { class: "tl" }, [dot, lbl]), tr = h("div", { class: "tr", text: "Idle" });
    var none = h("div", { class: "none", text: "No frame yet. The first order screenshot appears here." });
    var el = h("div", { class: "live", role: "button", "aria-label": "Live screen", onclick: openFull }, [a, b, none, tl, tr]);
    var order = h("div", { class: "lastorder" });
    var front = a, src = null;
    function update() {
      var fr = D.screen, meta = D.state && D.state.screen, ok = fr && fr.image;
      none.hidden = !!ok;
      if (ok && fr.image !== src) {
        var next = front === a ? b : a; src = fr.image;
        next.onload = function () { next.classList.add("on"); front.classList.remove("on"); front = next; };
        next.src = fr.image;                                    // double buffered: the old frame stays until the new one is decoded
      }
      var age = ok ? now() - fr.ts : null;
      dot.className = "dot" + (ok && age < 5 ? " red" : "");
      lbl.textContent = !ok ? "No frame yet" : age < 5 ? "Live · Bot's computer" : "Last frame " + clock(fr.ts);
      var hold = D.state && D.state.desk && D.state.desk.lane && D.state.desk.lane.holder;
      if (hold) { tr.textContent = cap(hold.bot === "test" ? "executor" : hold.bot) + " · " + (hold.side === "sell" ? "selling" : "buying"); tr.style.color = COLOR[hold.bot] || COLOR.executor; }
      else { tr.textContent = "Idle"; tr.style.color = ""; }
      // the last order, with its 3 checks
      order.textContent = "";
      var o = lastOrder();
      if (!o) { order.appendChild(h("span", { class: "dim", text: "No orders yet" })); }
      else {
        var s = o.symbol || shortMint(o.mint), txt;
        if (o.bot === "test") txt = "Lane test · " + s + " · " + money(o.usd) + " · " + (o.status === "done" ? "quote read, nothing bought" : o.status);
        else if (o.status === "done" && o.side === "buy") txt = "Bought " + s + " · " + money(o.fill_usd != null ? o.fill_usd : o.usd) + " · verified";
        else if (o.status === "done") txt = "Sold " + s + " · verified";
        else if (o.status === "unverified") txt = "Unverified: " + s + ", check FOMO";
        else txt = cap(o.side) + " " + s + " · " + o.status + (o.error ? " (" + o.error + ")" : "");
        order.appendChild(h("span", { text: txt, style: "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }));
        order.appendChild(checkRow(o.checks));
      }
    }
    function openFull() {
      if (!(D.screen && D.screen.image)) return;
      var img = $("fullimg"); img.src = D.screen.image; scale = 1; tx = ty = 0; apply();
      var bot = $("fullbot"); bot.textContent = "";
      var m = D.state && D.state.screen; var l = m && fomo(m.coin_url, "Open on FOMO", "btn blue"); if (l) bot.appendChild(l);
      $("full").classList.add("on");
    }
    return { el: el, order: order, update: update };
  }
  // full screen: pinch to zoom, drag, double tap resets; landscape is not locked
  var scale = 1, tx = 0, ty = 0, pts = {}, startD = 0, startS = 1, lastTap = 0;
  function apply() { $("fullimg").style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")"; }
  (function () {
    var st = $("full"), prev = null;
    st.addEventListener("pointerdown", function (e) { pts[e.pointerId] = e; if (Object.keys(pts).length === 2) { var k = Object.keys(pts); startD = dist(pts[k[0]], pts[k[1]]); startS = scale; }
      var t = Date.now(); if (Object.keys(pts).length === 1 && t - lastTap < 300) { scale = 1; tx = ty = 0; apply(); } lastTap = t; prev = { x: e.clientX, y: e.clientY }; });
    st.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return; var old = pts[e.pointerId]; pts[e.pointerId] = e; var k = Object.keys(pts);
      if (k.length === 2) { scale = Math.max(1, Math.min(6, startS * dist(pts[k[0]], pts[k[1]]) / (startD || 1))); apply(); }
      else if (k.length === 1 && scale > 1) { tx += e.clientX - old.clientX; ty += e.clientY - old.clientY; apply(); }
    });
    function up(e) { delete pts[e.pointerId]; if (scale <= 1.02) { scale = 1; tx = ty = 0; apply(); } }
    st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
    $("fullclose").addEventListener("click", function (e) { e.stopPropagation(); $("full").classList.remove("on"); });
    function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  })();

  // ------------------------------------------------------------ bot cards (Home carousel + Bots tab)
  function feedRows(name, n) {
    var rows = decs(name).slice(0, n), out = [];
    if (name === "scanner") rows.forEach(function (r) {
      var s = sym(r);
      out.push(r.verdict === "pass" ? h("div", { class: "r" }, [h("b", { class: "p", text: s }), h("span", { class: "p", text: "→ Analyst" })])
        : h("div", { class: "r" }, [h("span", { class: "k", text: s }), h("span", { class: "why", text: r.reason || r.verdict })]));
    });
    return out;
  }
  function layerStrips(mint) {
    var a = mint && D.audits && D.audits.mints && D.audits.mints[mint], L = (a && a.layers) || [], box = h("div", { class: "strips", "aria-label": "8 layers" });
    for (var i = 1; i <= 8; i++) {
      var l = L.filter(function (x) { return x.layer === i; })[0];
      box.appendChild(h("i", { class: l ? (l.pass === true ? "g" : l.pass === false ? "r" : "") : "", title: l ? l.name + ": " + l.value_text : "layer " + i + ": not checked" }));
    }
    return box;
  }
  function botBody(name, full) {
    var st = botStat(name), b = st.b, box = h("div"), T = tonight();
    if (name === "scanner") {
      var f = feedRows(name, full ? 5 : 4);
      box.appendChild(h("div", { class: "feed" }, f.length ? f : [h("span", { class: "dim", text: "Watching for graduations." })]));
    } else if (name === "analyst") {
      var last = decs("analyst")[0], score = last ? last.score : null;
      var cv = h("canvas", { width: 64, height: 64 }), rb = h("div", { class: "ringbox" }, [cv, h("b", { text: score == null ? "–" : String(Math.round(score)) })]);
      setTimeout(function () { window.DeskChart.ring(cv, score, 64); }, 0);
      var soc = D.state && D.state.desk && D.state.desk.social;
      var socTxt = last && last.social_pts != null && !/off/i.test(soc || "") ? "Social +" + (+last.social_pts).toFixed(1) : (soc || "Social: off");
      box.appendChild(h("div", { class: "arow", style: "margin-top:12px" }, [rb, h("div", { style: "flex:1;min-width:0" }, [layerStrips(last && last.mint),
        h("div", { class: "sub", style: "margin-top:8px", text: last ? sym(last) + " · " + (last.pass ? "passed" : (last.reason || "rejected")) : "Nothing audited yet" }),
        h("div", { class: "sub", style: "margin-top:2px", text: socTxt })])]));
    } else if (name === "brain") {
      var bd = decs("brain")[0], fin = bd && (bd.final && typeof bd.final === "object" ? bd.final : bd);
      var line = fin && fin.sizeUsd != null ? money(fin.sizeUsd) + " · " + (+fin.pctOfCash).toFixed(0) + "% of cash" : (fin && fin.reason ? "Skipped · " + fin.reason : "Waiting for a passed coin");
      var sc = fin && fin.score, fullSz = sc != null && sc >= 80;
      box.appendChild(h("div", { style: "font:600 20px var(--text-font);margin-top:12px", text: line }));
      box.appendChild(h("div", { class: "pills" }, [h("span", { class: "pill mono" + (sc != null && fullSz ? " pillgreen" : ""), text: "80+ = full size" }), h("span", { class: "pill mono" + (sc != null && !fullSz ? " pillgreen" : ""), text: "under 80 = half size" })]));
    } else if (name === "executor") {
      var bot = b.bar, hold = D.state && D.state.desk && D.state.desk.lane && D.state.desk.lane.holder, lo = lastOrder();
      var txt = bot || (hold && hold.bot ? (hold.side === "sell" ? "Clicking Sell..." : "Clicking Buy...") :
        (lo && lo.bot !== "test" && lo.status === "done" && lo.side === "buy" ? "✓ Bought · verified" : (D.state && D.state.desk && D.state.desk.paper && D.state.desk.paper.waiting_for_dip ? "Waiting for a dip -15%" : "Waiting for a pick")));
      box.appendChild(h("div", { style: "font:600 20px var(--text-font);margin-top:12px", text: txt }));
      box.appendChild(h("div", { class: "sub", text: b.lane || "" }));
      if (b.waiting) box.appendChild(h("div", { class: "sub", text: b.waiting + " waiting" }));
    } else {
      var open = positions().length;
      box.appendChild(h("div", { style: "font:600 20px var(--text-font);margin-top:12px", text: open ? "Guarding " + open : "Nothing open" }));
      box.appendChild(h("div", { class: "pills" }, [h("span", { class: "pill mono pillred", text: "stop -" + (setting("risk.stop_pct") != null ? setting("risk.stop_pct") : "25") + "%" }),
        h("span", { class: "pill mono pillgreen", text: "trail " + (setting("executor.trail_pct") != null ? setting("executor.trail_pct") : "40") + "%" })]));
    }
    return box;
  }
  function botCount(name) {
    var b = botStat(name).b, T = tonight();
    return name === "scanner" ? (T.migrations != null ? T.migrations + " pools" : "n/a")
      : name === "analyst" ? (T.audited != null ? T.audited + " taken apart" : "n/a")
      : name === "brain" ? "Sizing"
      : name === "executor" ? (b.trades != null ? b.trades + (b.trades === 1 ? " trade" : " trades") : "n/a")
      : (positions().length ? "Guarding" : "Guarding");
  }
  function dotClass(name) { var s = botStat(name); return "sdot " + (s.paused ? "pause" : s.down ? "down" : "ok"); }
  function homeBotCard(name) {
    var c = h("div", { class: "bot", style: "border-top:0" }, [
      h("div", { class: "hd" }, [h("i", { class: dotClass(name), style: "background:" + (botStat(name).down || botStat(name).paused ? "" : COLOR[name]) }),
        h("span", { class: "nm", style: "color:" + COLOR[name], text: NAME[name] }), h("span", { class: "cnt", text: botCount(name) })]),
      botBody(name, false)]);
    c.addEventListener("click", function () { go("bots"); });
    return c;
  }

  // ------------------------------------------------------------ activity rows
  function actRow(it, small) {
    var rej = it.kind === "rejected" || it.kind === "skipped";
    var target = it.mint ? (rej ? "audit/" + it.mint : "coin/" + it.mint) : null;
    var v = h("div", { class: "v" }, [it.value ? h("span", { class: it.kind === "stopped" ? "red" : it.kind === "sold" && /^\+/.test(it.value) ? "green" : "", text: it.value }) : null,
      it.coin_url ? h("small", {}, [fomo(it.coin_url, "Open on FOMO")]) : null]);
    var row = h("div", { class: "row tap", role: "button", onclick: function () { if (target) go(target); } }, [
      h("div", { class: "ico", text: (it.symbol || "?").charAt(0).toUpperCase() }),
      h("div", { class: "mid" }, [h("div", { class: "t", text: it.title || it.text || it.kind }), h("div", { class: "s", text: (it.subtitle ? it.subtitle + " · " : "") + clock(it.ts) })]), v]);
    return row;
  }
  function actList(items, n, emptyText) {
    var box = h("div");
    var rows = (items || []).slice(0, n);
    if (!rows.length) return h("div", { class: "list" }, [h("div", { class: "empty", text: emptyText })]);
    return h("div", { class: "list" }, rows.map(function (it) { return actRow(it); }));
  }

  // ------------------------------------------------------------ HOME
  function Home(root) {
    var range = "LIVE";
    var avatar = h("span", { class: "avatar", text: "?" });
    var bellDot = h("i", { class: "dotbadge", hidden: true });
    var nav = h("div", { class: "nav" }, [
      h("button", { class: "iconbtn", "aria-label": "Account", onclick: function () { go("account"); } }, [avatar]),
      h("button", { class: "title", onclick: grokSheet }, ["Grok Bot", h("span", { class: "chev", text: "›" })]),
      h("button", { class: "iconbtn", "aria-label": "Search", onclick: searchSheet }, [svg(ICON.search)]),
      h("button", { class: "iconbtn", "aria-label": "Notifications", onclick: bellSheet }, [svg(ICON.bell), bellDot])]);
    var odoHost = h("span", { class: "big", "aria-live": "polite" }), odo = new Odo(odoHost);
    var paper = h("span", { class: "pill paper", text: "PAPER", hidden: true });
    var today = h("span", { class: "today", text: " " }), mult = h("span", { class: "pill mult", hidden: true }), market = h("span", { class: "pill", hidden: true });
    var hero = h("div", { class: "hero" }, [h("div", { class: "label", text: "Balance" }), h("div", { class: "balrow" }, [odoHost, paper]), h("div", { class: "meta" }, [today, mult, market])]);
    var cv = h("canvas", { "aria-label": "Balance chart" }), ov = h("div", { class: "empty", style: "position:absolute;inset:0;display:grid;place-items:center;padding:0 24px", hidden: true });
    var chartwrap = h("div", { class: "chartwrap" }, [cv, ov]);
    var rg = h("div", { class: "ranges" }, ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (r) {
      return h("button", { class: r === range ? "on" : "", text: r, onclick: function () { range = r; [].forEach.call(rg.children, function (b) { b.classList.toggle("on", b.textContent === r); }); paintChart(); } });
    }));
    var wait = h("div", { class: "empty", hidden: true, text: "Waiting for the first trade" });
    var live = LiveCard();
    var botsTitle = h("h2", { text: "Bots" }), car = h("div", { class: "carousel" });
    var actBox = h("div");
    var content = h("div", {}, [hero, chartwrap, rg, wait, live.el, live.order,
      h("div", { class: "sec" }, [botsTitle]), car,
      h("div", { class: "sec" }, [h("h2", { text: "Activity" }), h("button", { class: "link", text: "See all", onclick: function () { go("activity"); } })]), actBox, h("div", { class: "tabsp" })]);
    var skel = sk([84, 230, 44, 190, 176]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(content);

    function paintChart() {
      var cd = D.chart; if (!cd) return;
      var r = (cd.ranges && cd.ranges[range]) || cd;
      var ev = (r.events || []).map(markFromEvent).filter(Boolean);
      if (!ev.length) ev = (r.marks || []).filter(function (m) { return m.side === "buy"; }).map(function (m) { return { ts: m.ts, text: "Bought " + (m.symbol || shortMint(m.mint)), color: "#0a84ff" }; });
      var pts = (r.points || []).map(function (p) { return { ts: p.ts, v: p.v }; });
      var ok = window.DeskChart.line(cv, { points: pts, marks: ev });
      ov.hidden = ok; if (!ok) ov.textContent = "Not enough points for this range yet";
    }
    function markFromEvent(e) {
      var s = e.title ? e.title.replace(/^(Bought|Sold|Stopped|Copied)\s+/, "") : "";
      if (e.kind === "bought" || e.kind === "copied") return { ts: e.ts, text: (e.kind === "copied" ? "Copied " : "Bought ") + s, color: "#0a84ff" };
      var v = e.value || ""; if (e.kind === "sold") return { ts: e.ts, text: v.split("·")[0].trim() || "Sold " + s, color: /^-/.test(v) ? "#ff453a" : "#00d35a" };
      var pct = ((e.subtitle || "").match(/-?\d+(\.\d+)?%/) || ["-25%"])[0]; if (pct.charAt(0) !== "-") pct = "-" + pct;
      return { ts: e.ts, text: pct + " · " + (v.split("·")[0].trim() || ""), color: "#ff453a" };
    }
    function update() {
      var ready = !!D.state; skel.hidden = ready; content.hidden = !ready; if (!ready) return;
      var s = D.state;
      avatar.textContent = (s.handle || "?").charAt(0).toUpperCase();
      odo.set(money(s.balance));
      paper.hidden = s.mode === "LIVE";
      today.textContent = sgnPct(s.today_pct) + " today"; today.className = "today " + (s.today_pct > 0 ? "green" : s.today_pct < 0 ? "red" : "dim");
      mult.hidden = s.multiplier == null; if (s.multiplier != null) mult.textContent = s.multiplier.toFixed(2) + "x";
      var mk = s.desk && s.desk.market_mode, mm = s.desk && s.desk.market || {};
      market.hidden = !mk; market.className = "pill" + (mk === "RED" ? " red" : "");
      market.textContent = mk === "RED" ? "Red mode · SOL " + (mm.sol_h1 != null ? sgnPct(mm.sol_h1, 1) : "n/a") + " 1h" : mk === "QUIET" ? "Quiet" : "Green market";
      botsTitle.textContent = "Bots · " + runningCount() + " running";
      paintChart();
      var o = lastOrder(), anyTrade = (D.chart && (D.chart.events || []).length) || positions().length || (o && o.bot !== "test" && o.status === "done");
      wait.hidden = !!anyTrade;
      live.update();
      var sl = car.scrollLeft; car.textContent = ""; BOTS.forEach(function (n) { car.appendChild(homeBotCard(n)); }); car.scrollLeft = sl;
      actBox.textContent = ""; actBox.appendChild(actList(D.activity && D.activity.items, 5, "Nothing yet tonight"));
      var seen = +localStorage.getItem(SEEN) || 0; bellDot.hidden = !((s.desk && s.desk.pushes || []).some(function (p) { return p.ts > seen; }));
    }
    return { update: update, resize: paintChart };
  }
  function grokSheet() {
    openSheet([h("h3", { text: "Grok Bot" }), h("div", { class: "note", text: "Overnight Desk 2.0 · five bots, one paper book. This app reads a published copy of the desk." }),
      h("div", { class: "arow2", style: "margin-top:8px" }, [h("div", {}, [h("div", { class: "k", text: "Watch in Grok Bot" }), h("div", { class: "s", text: "Needs the computer preview link (not published yet)" })]), h("button", { class: "dis", text: "Not connected", onclick: function () { toast("No preview link yet"); } })]),
      h("button", { class: "btn", style: "margin-top:10px", text: "Close", onclick: closeSheet })]);
  }
  function bellSheet() {
    var ps = (D.state && D.state.desk && D.state.desk.pushes || []).slice().reverse();
    localStorage.setItem(SEEN, String(now()));
    var list = ps.length ? h("div", { class: "list plain", style: "margin:0" }, ps.map(function (p) {
      return h("div", { class: "row" }, [h("div", { class: "mid" }, [h("div", { class: "t", style: "white-space:normal", text: p.title }), h("div", { class: "s", style: "white-space:normal", text: (p.body || "").split("\n")[0] + " · " + clock(p.ts) })])]);
    })) : h("div", { class: "empty", text: "No notifications yet" });
    openSheet([h("h3", { text: "Notifications" }), list, h("div", { class: "note", style: "margin-top:10px", text: "Pushes go to Telegram (@" + botName() + "). Plan B has no web push; this is the desk's own list." }), h("button", { class: "btn", style: "margin-top:10px", text: "Close", onclick: closeSheet })]);
    if (cur && cur.update) cur.update();
  }
  function searchSheet() {
    var inp = h("input", { class: "search", type: "search", placeholder: "Name, symbol or mint", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Search" });
    var res = h("div", { class: "list plain", style: "margin:12px 0 0" });
    function all() { var ms = (D.coins && D.coins.mints) || {}, a = (D.audits && D.audits.mints) || {}, o = {}; Object.keys(ms).forEach(function (m) { o[m] = { mint: m, symbol: ms[m].coin && ms[m].coin.symbol, name: ms[m].coin && ms[m].coin.name }; });
      Object.keys(a).forEach(function (m) { if (!o[m]) o[m] = { mint: m, symbol: a[m].symbol }; }); return Object.keys(o).map(function (m) { return o[m]; }); }
    function paint() {
      var q = inp.value.trim().toLowerCase(); res.textContent = "";
      var hits = all().filter(function (c) { return !q || (c.symbol || "").toLowerCase().indexOf(q) >= 0 || (c.name || "").toLowerCase().indexOf(q) >= 0 || c.mint.toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
      if (!hits.length) { res.appendChild(h("div", { class: "empty", text: q ? "No coin like that in the desk's recent coins" : "No coins yet" })); return; }
      hits.forEach(function (c) { res.appendChild(h("div", { class: "row tap sm", role: "button", onclick: function () { closeSheet(); go("coin/" + c.mint); } }, [h("div", { class: "ico", text: (c.symbol || "?").charAt(0).toUpperCase() }), h("div", { class: "mid" }, [h("div", { class: "t", text: c.symbol || shortMint(c.mint) }), h("div", { class: "s mono", text: (c.name ? c.name + " · " : "") + shortMint(c.mint) })])])); });
    }
    inp.addEventListener("input", paint); paint();
    openSheet([h("h3", { text: "Search" }), inp, res]); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 300);
  }

  // ------------------------------------------------------------ BOTS tab
  function decRow(name, r) {
    var s = sym(r), t, sub, right = null, target = r.mint ? (name === "scanner" || name === "analyst" ? "audit/" : "coin/") + r.mint : null;
    if (name === "scanner") { t = s + " · " + (r.verdict || ""); sub = r.reason || ""; }
    else if (name === "analyst") { t = s + " · score " + (r.score != null ? Math.round(r.score) : "n/a"); sub = (r.pass ? "passed" : "rejected") + (r.reason ? " · " + r.reason : ""); }
    else if (name === "brain") { var f = r.final && typeof r.final === "object" ? r.final : r; t = (f.mint ? bookSym(f.mint) : s) + " · " + (f.sizeUsd != null ? money(f.sizeUsd) : "skip"); sub = f.reason || ""; }
    else if (name === "executor") { t = s + " · " + (r.side || "buy") + " " + (r.usd != null ? money(r.usd) : ""); sub = (r.status || "") + (r.reason ? " · " + r.reason : "") + (r.error ? " · " + r.error : ""); }
    else { t = s + " · " + (r.reason || "closed"); sub = "entry " + price(r.entry_price) + " → exit " + price(r.exit_price); right = r.pnl_usd != null ? sgnMoney(r.pnl_usd) : null; }
    return h("div", { class: "row tap", role: "button", onclick: function () { if (target) go(target); } }, [
      h("div", { class: "mid" }, [h("div", { class: "t", text: t }), h("div", { class: "s", text: sub + (r.ts ? " · " + clock(r.ts) : "") })]),
      h("div", { class: "v" }, [right ? h("span", { class: /^-/.test(right) ? "red" : "green", text: right }) : null, r.coin_url ? h("small", {}, [fomo(r.coin_url, "Open on FOMO")]) : null])]);
  }
  function Bots(root) {
    var nav = h("div", { class: "nav" }, [h("h1", { text: "Bots", style: "text-align:left" })]);
    var box = h("div"), skel = sk([150, 150, 150]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(box);
    var openIdx = {};
    function update() {
      var ready = !!D.state; skel.hidden = ready; box.hidden = !ready; if (!ready) return;
      box.textContent = "";
      BOTS.forEach(function (n) {
        var st = botStat(n), locked = n === "risk" && positions().length > 0;
        var sw = h("button", { class: "swb", "aria-label": "Pause " + NAME[n], onclick: function () { if (locked) tgSheet("Risk can't be paused", null, "Risk is locked while a position is open."); else tgSheet((st.paused ? "Resume " : "Pause ") + NAME[n], (st.paused ? "resume " : "pause ") + NAME[n]); } }, [h("span", { class: "sw" + (st.paused ? "" : " on") + (locked ? " locked" : "") }, [h("i")])]);
        var decsList = decs(n).slice(0, 20), det = h("details", { class: "dec" }, [h("summary", {}, [decsList.length === 1 ? "Last decision" : "Last " + Math.min(20, decsList.length || 0) + " decisions"])]);
        if (openIdx[n]) det.open = true; det.addEventListener("toggle", function () { openIdx[n] = det.open; });
        if (!decsList.length) det.appendChild(h("div", { class: "empty", text: "No decisions yet tonight" })); else decsList.forEach(function (r) { det.appendChild(decRow(n, r)); });
        box.appendChild(h("div", { class: "bot full" }, [
          h("div", { class: "hd" }, [h("i", { class: dotClass(n), style: st.paused || st.down ? "" : "background:" + COLOR[n] }), h("span", { class: "nm", style: "color:" + COLOR[n], text: NAME[n] }), h("span", { class: "cnt", text: botCount(n) }), sw]),
          h("div", { class: "sub", text: (st.paused ? "Paused" : st.down ? "No heartbeat" : (st.headline || st.status || "")) + (locked ? " · locked while a position is open" : "") }),
          botBody(n, true), h("div", { class: "tgline" }, [tgTag("pause: via Telegram")]), det,
          h("button", { class: "btn", style: "margin-top:8px", text: "Settings", onclick: function () { go("account/" + n); } })]));
      });
    }
    return { update: update };
  }

  // ------------------------------------------------------------ ACTIVITY tab
  function ActivityScr(root) {
    var nav = h("div", { class: "nav" }, [h("h1", { text: "Activity", style: "text-align:left" })]);
    var box = h("div", { style: "padding-top:6px" }), skel = sk([64, 64, 64, 64]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(box);
    function update() {
      var ready = !!D.state; skel.hidden = ready; box.hidden = !ready; if (!ready) return;
      box.textContent = ""; box.appendChild(actList(D.activity && D.activity.items, 30, "Nothing yet tonight"));
    }
    return { update: update };
  }

  // ------------------------------------------------------------ AUDIT screen: the coin as 8 discs, a cyan beam reads each layer
  var LAYER_NAMES = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10", "Liquidity", "Pool age", "Bundles", "Delegations"];
  function Audit(root, mint) {
    var nav = pageNav("Audit"), box = h("div"), skel = sk([90, 360, 60]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(box);
    var scanned = null;
    function update() {
      var ready = !!(D.state && D.audits); skel.hidden = ready; box.hidden = !ready; if (!ready) return;
      var a = D.audits.mints && D.audits.mints[mint], c = D.coins && D.coins.mints && D.coins.mints[mint];
      var symbol = (a && a.symbol) || (c && c.coin && c.coin.symbol) || shortMint(mint);
      nav.querySelector("h1").textContent = "Audit · " + symbol;
      var key = JSON.stringify(a && [a.layers, a.score, a.scan]);
      if (key === scanned) return; scanned = key; box.textContent = "";
      var L = (a && a.layers) || [], score = a && a.score, scan = a && a.scan;
      var cvR = h("canvas", { width: 64, height: 64 });
      box.appendChild(h("div", { class: "coinhd" }, [h("div", { class: "arow", style: "justify-content:center;margin-top:6px" }, [
        h("div", { class: "ringbox" }, [cvR, h("b", { text: score ? String(Math.round(score.score)) : "–" })]),
        h("div", { style: "text-align:left" }, [h("div", { style: "font:700 24px var(--text-font)", text: symbol }), h("div", { class: "dim", style: "font-size:14px", text: shortMint(mint) })])])]));
      setTimeout(function () { window.DeskChart.ring(cvR, score ? score.score : null, 64); }, 0);
      var discs = h("div", { class: "discs" }, [h("i", { class: "beam" })]);
      for (var i = 1; i <= 8; i++) {
        var l = L.filter(function (x) { return x.layer === i; })[0];
        discs.appendChild(h("div", { class: "layer scan", style: "--i:" + (i - 1) }, [
          h("div", { class: "disc " + (l ? (l.pass === true ? "g" : l.pass === false ? "r" : "") : ""), text: l ? (l.pass === true ? "✓" : l.pass === false ? "✕" : "·") : String(i) }),
          h("div", { style: "min-width:0" }, [h("div", { class: "nm", text: l ? l.name : LAYER_NAMES[i - 1] }), h("div", { class: "vl", text: l ? l.value_text : "not checked" })])]));
      }
      box.appendChild(discs);
      var soc = a && a.social, sp = score && score.social_pts;
      var socRow = !a ? "Social: off" : (soc && !/off/i.test(soc) && sp != null ? "Social +" + (+sp).toFixed(1) : (soc || "Social: off"));
      box.appendChild(h("div", { class: "list", style: "margin-top:14px" }, [h("div", { class: "row sm" }, [h("div", { class: "mid" }, [h("div", { class: "t", text: socRow })])])]));
      if (!a || !L.length) box.appendChild(h("div", { class: "card" }, [h("div", { class: "t", style: "font-weight:600", text: scan && scan.verdict === "kill" ? "Killed by Scanner, never audited" : "Not audited yet" }), h("div", { class: "note", style: "margin-top:4px", text: scan && scan.reason ? "Scanner: " + scan.reason : "Analyst takes a coin apart only after Scanner passes it." })]));
      else if (score) box.appendChild(h("div", { class: "card" }, [h("div", { style: "font-weight:600", text: score.pass ? "Passed · score " + Math.round(score.score) : "Rejected · score " + Math.round(score.score) }), h("div", { class: "note", style: "margin-top:4px", text: score.reason || "" })]));
      var u = a && a.coin_url || (c && c.coin_url);
      if (u) box.appendChild(h("div", { class: "btnrow" }, [fomo(u, "Open on FOMO", "btn blue"), h("button", { class: "btn", text: "Coin", onclick: function () { go("coin/" + mint); } })]));
      box.appendChild(h("div", { class: "tabsp" }));
    }
    return { update: update };
  }

  // ------------------------------------------------------------ COIN screen
  function Coin(root, mint) {
    var paper = h("span", { class: "pill paper", text: "PAPER", hidden: true });
    var nav = pageNav("", paper), box = h("div"), skel = sk([60, 90, 200, 80, 120]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(box);
    function update() {
      var ready = !!(D.state && D.coins); skel.hidden = ready; box.hidden = !ready; if (!ready) return;
      paper.hidden = !isPaper();
      var c = D.coins.mints && D.coins.mints[mint], a = D.audits && D.audits.mints && D.audits.mints[mint];
      box.textContent = "";
      if (!c) {
        nav.querySelector("h1").textContent = shortMint(mint);
        box.appendChild(h("div", { class: "card" }, [h("div", { style: "font-weight:600", text: "No data for this coin" }), h("div", { class: "note", style: "margin-top:4px", text: "The desk publishes the 40 most recent coins it touched. This one isn't in that set." })]));
        return;
      }
      var co = c.coin || {}, symbol = co.symbol || shortMint(mint), pos = c.position && !c.position.closed_at ? c.position : null, px = c.price || {}, sc = c.scan || {};
      var created = co.migrated_at || co.created_at, age = created ? ageTxt((now() - created) / 60) : null;
      nav.querySelector("h1").textContent = symbol + " · Solana" + (age ? " · " + age : "");
      var L = (a && a.layers) || [], pass = L.filter(function (l) { return l.pass === true; }).length;
      var sh = h("span", { class: "shield " + (!L.length ? "na" : (pass === 8 ? "" : "bad")), text: "🛡 " + (L.length ? pass + "/8" : "–/8") });
      var first = (c.candles || [])[0], lastC = (c.candles || []).slice(-1)[0];
      var base = pos ? pos.entry_price : (first && first.o), chg = base && px.price ? (px.price / base - 1) * 100 : null;
      box.appendChild(h("div", { class: "coinhd" }, [h("div", {}, [sh]),
        h("div", { class: "big mid", style: "margin-top:8px", text: price(px.price) }),
        h("div", { class: "today " + (chg > 0 ? "green" : chg < 0 ? "red" : "dim"), text: chg == null ? "n/a" : (chg >= 0 ? "▲ " : "▼ ") + Math.abs(chg).toFixed(2) + "% " + (pos ? "since entry" : "since first sample") })]));
      var cv = h("canvas", { "aria-label": "1 minute candles" }), wrap = h("div", { class: "chartwrap", style: "height:210px" }, [cv]);
      box.appendChild(wrap);
      var ok = window.DeskChart.candles(cv, { candles: c.candles, exit: pos && pos.stop_price });
      if (!ok) wrap.appendChild(h("div", { class: "empty", style: "position:absolute;inset:0;display:grid;place-items:center", text: "No 1-minute candles yet" }));
      var mcap = sc.liquidity_usd && sc.liq_mcap ? sc.liquidity_usd / sc.liq_mcap : null;
      box.appendChild(h("div", { class: "stats" }, [h("div", {}, [h("div", { class: "k", text: "Market cap" }), h("div", { class: "v", text: compact(mcap) })]),
        h("div", {}, [h("div", { class: "k", text: "Liquidity" }), h("div", { class: "v", text: compact(sc.liquidity_usd) })]),
        h("div", {}, [h("div", { class: "k", text: "Holders" }), h("div", { class: "v", text: px.holders != null ? String(px.holders) : co.holders != null ? String(co.holders) : "n/a" })])]));
      box.appendChild(h("div", { class: "card" }, pos ? [h("div", { style: "font:600 17px var(--text-font)", text: "Your position · " + money(pos.size_usd) + " in Executor" }),
        h("div", { class: "sub", text: "Entry " + price(pos.entry_price) + (pos.pnl_pct != null ? " · " + sgnPct(pos.pnl_pct) : "") + (pos.stop_price ? " · exit " + price(pos.stop_price) : "") })]
        : [h("div", { style: "font:600 17px var(--text-font)", text: "No position" }), h("div", { class: "sub", text: "Executor doesn't hold this coin." })]));
      var sellBtn = h("button", { class: "btn" + (pos ? "" : " off"), text: "Sell now", onclick: function () { if (pos) sellSheet(symbol); else toast("No position to sell"); } });
      box.appendChild(h("div", { class: "btnrow" }, [fomo(c.coin_url, "Open on FOMO", "btn blue"), sellBtn]));
      box.appendChild(h("div", { class: "tgline", style: "padding:0 var(--gut)" }, [tgTag("sell: via Telegram")]));
      box.appendChild(h("div", { class: "btnrow" }, [h("button", { class: "btn", text: "Audit", onclick: function () { go("audit/" + mint); } })]));
      box.appendChild(h("div", { class: "tabsp" }));
    }
    return { update: update, resize: update };
  }
  function sellSheet(symbol) {
    var pct = 100, cmd = h("div", { class: "cmd" });
    function paint() { cmd.textContent = "sell " + symbol + " " + pct; [].forEach.call(seg.children, function (b) { b.classList.toggle("on", b.textContent === pct + "%"); }); }
    var seg = h("div", { class: "seg" }, [25, 50, 100].map(function (p) { return h("button", { text: p + "%", onclick: function () { pct = p; paint(); } }); }));
    openSheet([h("h3", { text: "Sell " + symbol }), seg, h("div", { class: "note", style: "margin-top:12px", text: "The phone can't reach the desk (Plan B). Send this to @" + botName() + " in Telegram: it asks \"Sell N% of " + symbol + " now?\" and Executor sells when you say yes." }), cmd,
      h("button", { class: "btn blue", text: "Copy command", onclick: function () { copy(cmd.textContent); } }),
      h("button", { class: "btn off", style: "margin-top:10px", text: "Confirm sell · via Telegram", onclick: function () { copy(cmd.textContent); toast("Command copied. Send it to the desk bot."); } }),
      h("button", { class: "btn", style: "margin-top:10px", text: "Close", onclick: closeSheet })]);
    paint();
  }

  // ------------------------------------------------------------ ACCOUNT tab
  var GROUPS = ["scanner", "analyst", "social", "brain", "executor", "risk", "regime", "picks", "vault", "repos", "browser", "desk"];
  var HIDE = { "desk.mode": 1, "desk.paper_start_cash": 1, "desk.click_lane": 0 };
  function maskVal(k, v) { if (typeof v === "string" && /^set( ·|$)/.test(v)) return v; return /address|url/i.test(k) && v ? "set" : v; }
  function Account(root, focus) {
    var nav = h("div", { class: "nav" }, [h("h1", { text: "Account", style: "text-align:left" })]);
    var box = h("div"), skel = sk([60, 100, 150, 300]);
    root.appendChild(nav); root.appendChild(offlineRow()); root.appendChild(skel); root.appendChild(box);
    var openG = {}; if (focus) openG[focus] = true;
    function rowK(k, sub, right) { return h("div", { class: "arow2" }, [h("div", { style: "min-width:0" }, [h("div", { class: "k", text: k }), sub ? h("div", { class: "s", text: sub }) : null]), right]); }
    function settingRow(key, s) {
      var label = key.split(".").slice(1).join(".").replace(/_/g, " "), v = s.value, rg = s.range, field;
      var cmd = "set " + key.split(".")[0] + " " + label + " to " + (typeof v === "boolean" ? v : v);
      var top = h("div", { class: "top" }, [h("span", { class: "k", text: label }), h("span", { class: "rg", text: Array.isArray(rg) && typeof rg[0] === "number" ? rg[0] + "–" + rg[1] : "" })]);
      var numeric = Array.isArray(rg) && typeof rg[0] === "number" && typeof v === "number";
      var el = h("div", { class: "setting" + (numeric ? "" : " tap"), onclick: numeric ? null : function () { tgSheet("Change " + label, cmd); } }, [top]);
      if (numeric) {
        var lo = rg[0], hi = rg[1], whole = v % 1 === 0 && lo % 1 === 0 && hi % 1 === 0;
        var msg = h("div", { class: "rgmsg", role: "status", text: "" });
        var num = h("input", { type: "number", step: "any", value: v, "aria-label": label + " exact value" });
        var sl = h("input", { type: "range", min: lo, max: hi, step: whole ? ((hi - lo) > 100 ? 1 : 1) : ((hi - lo) > 100 ? 1 : "any"), value: v, "aria-label": label });
        function fmt(x) { return String(Math.round(x * 1e6) / 1e6); }
        function send(x) {
          var c = "set " + key.split(".")[0] + " " + label + " to " + fmt(x);
          tgSheet("Change " + label + ": " + fmt(v) + " → " + fmt(x), c, "Allowed range " + lo + "–" + hi + ". Nothing changes until you send this to the desk bot; it refuses out-of-range values and says the range.");
        }
        sl.addEventListener("input", function () { num.value = sl.value; msg.textContent = ""; });
        sl.addEventListener("change", function () { var x = Number(sl.value); if (x !== v) send(x); });
        num.addEventListener("change", function () {
          var raw = num.value.trim(), x = Number(raw);
          if (raw === "" || !isFinite(x)) { num.value = v; sl.value = v; msg.textContent = "Enter a number between " + lo + " and " + hi; return; }
          if (x < lo || x > hi) { num.value = v; sl.value = v; msg.textContent = "Out of range: " + label + " must be between " + lo + " and " + hi; return; }
          msg.textContent = ""; sl.value = x; if (x !== v) send(x);
        });
        top.insertBefore(num, top.lastChild); el.appendChild(sl); el.appendChild(msg);
      } else if (typeof v === "boolean") top.insertBefore(h("span", { class: "sw" + (v ? " on" : "") + " locked" }, [h("i")]), top.lastChild);
      else top.insertBefore(h("span", { class: "nf", style: "width:auto;min-width:92px;line-height:34px;display:inline-block", text: String(maskVal(key, v) == null || maskVal(key, v) === "" ? "—" : maskVal(key, v)) }), top.lastChild);
      return el;
    }
    function update() {
      var ready = !!(D.state && D.account); skel.hidden = ready; box.hidden = !ready; if (!ready) return;
      var A = D.account, S = D.settings || {}, st = D.state;
      box.textContent = "";
      box.appendChild(h("div", { class: "banner", text: (A.writes && A.writes.note) || "Changes from the phone go through Telegram." }));
      // PAPER / LIVE
      var live = A.mode === "LIVE";
      box.appendChild(h("div", { class: "grp", style: "padding:12px 14px" }, [h("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [h("span", { style: "font:600 17px var(--text-font)", text: "Mode" }), tgTag()]),
        h("div", { class: "note live-line", style: "margin:0 0 8px;color:var(--t1)", text: A.live_line || "LIVE trades real cash on FOMO. New coins can go to 0 in minutes. Only put in what you can lose." }),
        h("div", { class: "seg off" }, ["PAPER", "LIVE"].map(function (m) { return h("button", { class: (live ? m === "LIVE" : m === "PAPER") ? "on" : "", text: m, onclick: function () { tgSheet(m === "LIVE" ? "Switch to LIVE" : "Switch to PAPER", m === "LIVE" ? "live" : "paper", m === "LIVE" ? "LIVE needs the typed word LIVE, and stays locked until STEP 15 passes." : null); } }); })),
        h("div", { class: "note", style: "margin-top:8px", text: live ? "LIVE: real cash on FOMO." : "PAPER: simulated cash. " + (A.live_locked || "") })]));
      // cash
      var cashS = S["desk.paper_start_cash"], onchain = st.cash && st.cash.usdc;
      box.appendChild(h("div", { class: "grp" }, [rowK("Cash", "On-chain USDC " + money(onchain), h("span", { class: "tap", onclick: function () { tgSheet("Paper cash", "set paper start cash to " + (cashS ? cashS.value : 100)); } }, [h("input", { class: "nf", style: "width:96px;height:34px;border-radius:9px;border:0;background:var(--card2);text-align:right;padding:0 9px;color:var(--t2);font:500 15px var(--text-font)", value: cashS ? money(cashS.value, 0) : "n/a", disabled: true, "aria-label": "Paper cash" })]))]));
      // FOMO links
      box.appendChild(h("div", { class: "grp" }, [
        rowK("Your FOMO profile", A.handle ? "@" + A.handle : null, A.profile_url ? fomo(A.profile_url, "Open on FOMO") : h("span", { class: "dim", text: "n/a" })),
        rowK("Invite a friend", "Opens the share sheet; if it can't, the link is copied", A.signup_url ? h("button", { text: "Share", onclick: function () { share(A.signup_url); } }) : h("span", { class: "dim", text: "n/a" }))]));
      // settings per bot
      box.appendChild(h("div", { class: "sec", style: "padding-bottom:0" }, [h("h2", { text: "Settings" }), tgTag("changes via Telegram")]));
      GROUPS.forEach(function (g) {
        var keys = Object.keys(S).filter(function (k) { return k.split(".")[0] === g && !HIDE[k]; });
        if (!keys.length) return;
        var d = h("details", { class: "grp", id: "g-" + g }, [h("summary", {}, [h("span", { text: cap(g) }), h("span", { class: "dim", style: "margin-left:auto;margin-right:8px;font:400 14px var(--text-font)", text: keys.length })])]);
        if (openG[g]) d.open = true; d.addEventListener("toggle", function () { openG[g] = d.open; });
        keys.forEach(function (k) { d.appendChild(settingRow(k, S[k])); });
        box.appendChild(d);
      });
      // copy picks
      var pe = S["picks.every"], pt = S["picks.time"], ev = pe ? pe.value : "off";
      box.appendChild(h("div", { class: "grp", style: "padding:12px 14px" }, [h("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [h("span", { style: "font:600 17px var(--text-font)", text: "Copy picks" }), tgTag()]),
        h("div", { class: "seg off" }, [["off", "off"], ["24h", "24h"], ["12h", "12h"], ["6h", "6h"]].map(function (o) { return h("button", { class: ev === o[1] ? "on" : "", text: o[0], onclick: function () { tgSheet("Copy picks", "set picks every to " + o[1]); } }); })),
        h("div", { class: "note", style: "margin-top:8px", text: "First run at " + (pt ? pt.value : "21:30") + " · off until STEP 15 passes" })]));
      // vault, pushes, watch
      var subs = A.push_subscriptions || 0;
      box.appendChild(h("div", { class: "grp" }, [
        rowK("Vault", (A.vault ? A.vault.notes + " notes · " + (A.vault.last_write ? "last write " + clock(A.vault.last_write) : "no write yet") + " · " + A.vault.where : "Plugin or files: not set up yet"), h("span", { class: "dim", text: A.vault ? A.vault.label : "Vault: files · not on iPhone" })),
        rowK("Pushes", "Plan B: Telegram only, no web push", h("span", { class: (A.telegram && A.telegram.bound) || subs ? "green" : "dim", text: (A.telegram && A.telegram.bound) ? "Telegram connected" : subs ? "connected" : "not paired yet" })),
        rowK("Send test push", null, h("button", { class: "dis", text: "via Telegram", onclick: function () { tgSheet("Send test push", "test", "The desk answers with a test push in Telegram."); } })),
        rowK("Watch in Grok Bot", "Opens your own computer preview (no link published yet)", h("button", { class: "dis", text: "Not connected", onclick: function () { toast("No preview link yet"); } }))]));
      // recent changes
      var ch = A.recent_changes || [];
      box.appendChild(h("div", { class: "sec" }, [h("h2", { text: "Recent changes" })]));
      box.appendChild(h("div", { class: "list" }, ch.length ? ch.slice(0, 8).map(function (c) { return h("div", { class: "row sm" }, [h("div", { class: "mid" }, [h("div", { class: "t", text: c.key }), h("div", { class: "s", text: c.old + " → " + c.new + " · " + c.who + " · " + clock(c.ts) })])]); }) : [h("div", { class: "empty", text: "No changes yet" })]));
      box.appendChild(h("div", { class: "tabsp" }));
      if (focus && !box._focused) { box._focused = true; var t = document.getElementById("g-" + focus); if (t) setTimeout(function () { t.scrollIntoView({ block: "start" }); }, 0); }
    }
    return { update: update };
  }

  // ------------------------------------------------------------ router
  function parse() {
    var m = (location.hash || "").replace(/^#\/?/, "").split("/");
    var name = m[0] || "home";
    return { name: ["home", "bots", "activity", "account", "coin", "audit"].indexOf(name) >= 0 ? name : "home", arg: m[1] || null };
  }
  function go(route) { location.hash = "#/" + route; }
  var routeKey = null;
  function mount() {
    var r = parse(), key = r.name + "/" + (r.arg || "");
    if (key === routeKey) return; routeKey = key;
    var view = $("view"); view.textContent = ""; offEls = [];
    var make = { home: Home, bots: Bots, activity: ActivityScr, account: Account, coin: Coin, audit: Audit }[r.name];
    cur = make(view, r.arg);
    var tab = ({ coin: "home", audit: "home" })[r.name] || r.name;
    [].forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    window.scrollTo(0, 0); refresh();
  }
  function refresh() { if (cur && cur.update) cur.update(); paintOffline(); }
  window.addEventListener("hashchange", function () { closeSheet(); mount(); });
  window.addEventListener("resize", function () { if (cur && cur.resize) cur.resize(); });
  [].forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.addEventListener("click", function () { go(b.dataset.tab); }); });

  // ------------------------------------------------------------ first open: "Paste your desk link"
  function readHash() {
    var m = location.hash.match(/[#&]d=([0-9a-f]{20,40})/i);
    if (m) { localStorage.setItem(KEY, m[1]); history.replaceState(null, "", location.pathname + location.search); } // hide the secret
    return localStorage.getItem(KEY);
  }
  function savePasted(txt) {
    var d = String(txt || "").match(/[#&]d=([0-9a-f]{20,40})/i);
    if (d) { localStorage.setItem(KEY, d[1]); return true; }
    return false;
  }
  function showPaste() {
    $("tabs").hidden = true;
    var inp = h("input", { id: "link", type: "url", inputmode: "url", autocapitalize: "off", autocorrect: "off", spellcheck: "false", placeholder: "https://…#d=…", "aria-label": "Paste your desk link" });
    var msg = h("div", { class: "note", style: "margin-top:10px" });
    var f = h("form", { class: "paste", autocomplete: "off", onsubmit: function (e) { e.preventDefault(); var v = inp.value; inp.value = ""; if (savePasted(v)) { start(); } else msg.textContent = "That link doesn't look right. Paste the whole desk link."; } },
      [h("label", { for: "link", text: "Paste your desk link" }), inp, h("button", { class: "btn blue", type: "submit", text: "Connect" }), msg]);
    var v = $("view"); v.textContent = ""; v.appendChild(f);
  }
  function start() {
    gist = readHash();
    if (!gist || !owner()) { showPaste(); return; }
    $("tabs").hidden = false; routeKey = null; mount(); tick();
    if (!net.started) {
      net.started = true;
      timer = setInterval(tick, POLL_MS); setInterval(paintOffline, 1000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
  start();
})();
