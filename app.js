// Overnight Desk web app. Static; all data comes at runtime from a secret gist.
// The gist id is the secret: it arrives once as  #d=<id>, is saved in localStorage,
// and is then removed from the address bar. It is never part of this repo.
(function () {
  "use strict";
  var KEY = "desk.gist";
  var POLL_MS = 15000;                 // raw endpoint has no documented per-IP limit
  var $ = function (id) { return document.getElementById(id); };
  var gist = null, failures = 0, lastGood = 0, timer = null;

  function owner() {
    var m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    return m ? m[1] : localStorage.getItem("desk.owner");
  }

  function readHash() {
    var m = location.hash.match(/[#&]d=([0-9a-f]{20,40})/i);
    if (m) {
      localStorage.setItem(KEY, m[1]);
      history.replaceState(null, "", location.pathname + location.search); // hide the secret
    }
    return localStorage.getItem(KEY);
  }

  function say(msg) { var n = $("notice"); n.textContent = msg; n.hidden = !msg; }

  function text(el, v) { el.textContent = v; }

  function money(v) { return v == null ? "n/a" : "$" + Number(v).toFixed(2); }

  // href is the exact coin_url / profile_url the desk put in the gist. Never rewrite or wrap it.
  function fomoLink(url, label) {
    if (!url) return null;
    var a = document.createElement("a");
    a.href = url;
    a.textContent = label || "Open on FOMO";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "fomo";
    return a;
  }

  function ago(sec) {
    if (sec < 90) return Math.round(sec) + "s";
    if (sec < 5400) return Math.round(sec / 60) + "m";
    return Math.round(sec / 3600) + "h";
  }

  function rawUrl(name, bust) {
    // bust: a changing query forces the CDN to fetch the latest version (max-age=300 otherwise)
    return "https://gist.githubusercontent.com/" + owner() + "/" + gist + "/raw/" + name +
      "?t=" + Date.now();
  }

  function getJson(name) {
    return fetch(rawUrl(name), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(name + " " + r.status);
      return r.json();
    });
  }

  function fallbackApi() {
    // One call returns all files; 60 requests/hour/IP unauthenticated, so use only on raw failure.
    return fetch("https://api.github.com/gists/" + gist, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("api " + r.status);
      return r.json();
    }).then(function (g) {
      function f(n) { return g.files[n] ? JSON.parse(g.files[n].content) : null; }
      return [f("state.json"), f("activity.json"), f("chart.json")];
    });
  }

  function renderBots(bots) {
    var box = $("bots"); box.textContent = "";
    var names = Object.keys(bots || {});
    if (!names.length) { var e = document.createElement("div"); e.className = "empty"; e.textContent = "No bot data yet."; box.appendChild(e); return; }
    names.forEach(function (n) {
      var b = bots[n], d = document.createElement("div");
      var age = b.last_beat ? Date.now() / 1000 - b.last_beat : null;
      d.className = "bot " + (age != null && age < 120 ? "ok" : "down");
      var s = document.createElement("span"), dot = document.createElement("i"), nm = document.createElement("b");
      dot.className = "dot"; nm.textContent = n;
      s.appendChild(dot); s.appendChild(document.createTextNode(b.status || "unknown"));
      d.appendChild(nm); d.appendChild(s); box.appendChild(d);
    });
  }

  function renderPositions(list) {
    var box = $("positions"); box.textContent = "";
    if (!list || !list.length) { box.innerHTML = ""; var e = document.createElement("div"); e.className = "empty"; e.textContent = "No open positions. The bots are idle and waiting for a first pick."; box.appendChild(e); return; }
    list.forEach(function (p) {
      var r = document.createElement("div"); r.className = "row";
      var a = document.createElement("span"), b = document.createElement("span");
      a.textContent = p.symbol || p.mint || "?"; b.textContent = money(p.usd);
      r.appendChild(a); r.appendChild(b);
      var open = fomoLink(p.coin_url);
      if (open) { var c = document.createElement("div"); c.className = "row-link"; c.appendChild(open); r.appendChild(c); }
      box.appendChild(r);
    });
  }

  function renderActivity(act) {
    var box = $("activity"); box.textContent = "";
    var items = act && act.items || [];
    if (!items.length) { var e = document.createElement("div"); e.className = "empty"; e.textContent = "Nothing yet. Trades and decisions will show up here."; box.appendChild(e); return; }
    items.slice(0, 30).forEach(function (it) {
      var r = document.createElement("div"); r.className = "row";
      var a = document.createElement("span"), b = document.createElement("span");
      a.textContent = it.text || ""; b.textContent = it.ts ? new Date(it.ts * 1000).toLocaleTimeString() : "";
      r.appendChild(a); r.appendChild(b);
      var open = fomoLink(it.coin_url);
      if (open) { var c = document.createElement("div"); c.className = "row-link"; c.appendChild(open); r.appendChild(c); }
      box.appendChild(r);
    });
  }

  function render(state, act, chart) {
    var mode = (state && state.mode) || "?";
    text($("mode"), mode); $("mode").className = "pill " + mode.toLowerCase();
    text($("cash"), money(state && state.cash && state.cash.usdc));
    var balEl = $("bal");
    if (balEl) {
      var parts = [];
      if (state && state.balance != null) parts.push("Balance " + money(state.balance));
      if (state && state.today_pct != null) parts.push("today " + (state.today_pct >= 0 ? "+" : "") + state.today_pct.toFixed(1) + "%");
      if (state && state.multiplier != null) parts.push(state.multiplier.toFixed(2) + "x");
      balEl.textContent = parts.join(" · ");
    }
    var sol = state && state.cash && state.cash.sol;
    text($("sol"), sol == null ? "" : sol + " SOL");
    var prof = $("profile");
    if (prof) {
      prof.textContent = "";
      var pl = fomoLink(state && state.profile_url, (state && state.handle) ? "@" + String(state.handle).replace(/^@/, "") : "Open on FOMO");
      if (pl) prof.appendChild(pl);
    }
    renderBots(state && state.bots);
    renderPositions(state && state.positions);
    renderActivity(act);
    var pts = chart && chart.equity || [];
    var ok = window.drawEquity($("chart"), pts.map(function (p) { return typeof p === "number" ? p : p.v; }));
    text($("chart-empty"), ok ? "" : "Not enough data for a chart yet.");
    var pub = state && state.published_at;
    var fresh = $("fresh");
    if (pub) {
      var s = Date.now() / 1000 - pub;
      fresh.textContent = "Updated " + ago(s) + " ago";
      fresh.className = "dim" + (s > 150 ? " stale" : "");
    }
  }

  function tick() {
    var p = getJson("state.json").then(function (state) {
      return Promise.all([Promise.resolve(state), getJson("activity.json").catch(function () { return null; }),
                          getJson("chart.json").catch(function () { return null; })]);
    }).catch(function () { return fallbackApi(); });
    p.then(function (r) {
      failures = 0; lastGood = Date.now(); say(""); $("app").hidden = false; render(r[0], r[1], r[2]);
    }).catch(function () {
      failures++;
      if (lastGood) say("Can't reach the desk right now. Showing the last update.");
      else say("Can't load desk data. Check the link, or try again in a minute.");
    });
  }

  function savePasted(txt) {
    // Accept the full desk link. #d=<id> (Plan B) is the data key; #t=<token> (Plan A) is only kept locally.
    var d = String(txt || "").match(/[#&]d=([0-9a-f]{20,40})/i);
    var t = String(txt || "").match(/[#&]t=([A-Za-z0-9_\-]{20,})/);
    if (t) localStorage.setItem("desk.token", t[1]);
    if (d) { localStorage.setItem(KEY, d[1]); return true; }
    return !!t;
  }

  function showPaste() {
    var f = $("paste"); if (!f) return;
    f.hidden = false;
    f.onsubmit = function (e) {
      e.preventDefault();
      var v = $("link").value; $("link").value = "";
      if (savePasted(v)) { f.hidden = true; start(); }
      else say("That link doesn't look right. Paste the whole desk link.");
    };
  }

  function start() {
    gist = readHash();
    if (!gist || !owner()) {
      say(""); showPaste();
      return;
    }
    if ($("paste")) $("paste").hidden = true;
    tick(); timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  start();
})();
