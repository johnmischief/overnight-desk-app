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
      r.appendChild(a); r.appendChild(b); box.appendChild(r);
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
      r.appendChild(a); r.appendChild(b); box.appendChild(r);
    });
  }

  function render(state, act, chart) {
    var mode = (state && state.mode) || "?";
    text($("mode"), mode); $("mode").className = "pill " + mode.toLowerCase();
    text($("cash"), money(state && state.cash && state.cash.usdc));
    var sol = state && state.cash && state.cash.sol;
    text($("sol"), sol == null ? "" : sol + " SOL");
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

  function start() {
    gist = readHash();
    if (!gist || !owner()) {
      say("Open your private desk link to connect. (This page has no data by itself.)");
      return;
    }
    tick(); timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  start();
})();
