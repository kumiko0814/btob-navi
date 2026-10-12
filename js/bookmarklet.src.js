/* BtoB仕入れ判定ナビ ワンクリック取込（この内容が javascript: リンクになる。__TOOL__ はナビのURLに置換）
   会員サイトの一覧ページで押す → 表（または繰り返しブロック）を読み取り → 「次へ」があれば最大20ページ辿る → ナビの画面へ postMessage で渡す */
(function () {
  var TOOL = "__TOOL__";
  function clean(s) { return ("" + (s || "")).replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
  function fromTables(doc) {
    var ts = [].slice.call(doc.querySelectorAll("table")), best = null;
    ts.forEach(function (t) { if (t.rows.length >= 2 && (!best || t.rows.length > best.rows.length)) best = t; });
    if (!best) return null;
    var rows = [];
    for (var i = 0; i < best.rows.length; i++) {
      var r = best.rows[i], c = [];
      for (var j = 0; j < r.cells.length; j++) {
        var cell = r.cells[j], txt = clean(cell.innerText || cell.textContent), a = cell.querySelector("a[href]");
        if (!txt && a) txt = a.href;
        c.push(txt);
      }
      rows.push(c);
    }
    return rows;
  }
  function fromCards(doc) {
    var cand = {}, els = doc.querySelectorAll("li, article, div");
    for (var i = 0; i < els.length; i++) {
      var e = els[i]; if (e.children.length < 2) continue;
      var t = e.innerText || ""; if (t.length < 10 || t.length > 700) continue;
      if (!/([¥￥]\s?\d{1,3}(,\d{3})+|\d{1,3}(,\d{3})+\s?円|\d{3,7}\s?円)/.test(t)) continue;
      var key = e.tagName + "." + ("" + (e.className || "")).split(/\s+/).slice(0, 2).join(".");
      (cand[key] = cand[key] || []).push(e);
    }
    var bestK = null;
    Object.keys(cand).forEach(function (k) { if (cand[k].length >= 5 && (!bestK || cand[k].length > cand[bestK].length)) bestK = k; });
    if (!bestK) return null;
    return cand[bestK].map(function (e) { return (e.innerText || "").split(/\n+/).map(clean).filter(Boolean); });
  }
  function nextLink(doc) {
    var as = [].slice.call(doc.querySelectorAll("a[href]"));
    for (var i = 0; i < as.length; i++) {
      var t = clean(as[i].innerText || as[i].textContent), h = as[i].getAttribute("href") || "";
      if (!h || h.charAt(0) === "#" || /^javascript:/i.test(h)) continue;
      if (/^(次へ|次のページ|次の\d+件|次|>|»|＞|NEXT|Next)$/.test(t) || /^次へ/.test(t)) return as[i].href;
    }
    return null;
  }
  var rows = fromTables(document) || fromCards(document);
  if (!rows || !rows.length) { alert("一覧が見つかりませんでした。落札結果や相場検索の一覧が表示されているページで押してください。"); return; }
  var header = rows[0].join("\t");
  var win = window.open(TOOL + "?recv=1", "btobnavi");
  if (!win) { alert("ナビの画面を開けませんでした。ポップアップを許可してからもう一度押してください。"); return; }
  var pages = 1, MAX = 20, seen = {}; seen[location.href] = 1;
  function finish() {
    var tries = 0, done = false;
    function onMsg(ev) {
      if (ev.data && ev.data.type === "btob-ack") {
        done = true; window.removeEventListener("message", onMsg);
        alert("BtoB仕入れ判定ナビに " + ev.data.n + " 行を送りました（" + pages + "ページ分）。ナビの画面で列を確認して「取り込む」を押してください。");
      }
    }
    window.addEventListener("message", onMsg);
    var iv = setInterval(function () {
      if (done || tries++ > 40) { clearInterval(iv); if (!done) alert("ナビの画面に届きませんでした。ナビのタブが開いているか確認して、もう一度押してください。"); return; }
      try { win.postMessage({ type: "btob-rows", rows: rows, url: location.href, title: document.title, pages: pages }, "*"); } catch (e) { }
    }, 500);
  }
  function crawl(href) {
    if (!href || seen[href] || pages >= MAX) { finish(); return; }
    seen[href] = 1;
    fetch(href, { credentials: "include" }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var more = fromTables(doc);
      if (!more || !more.length) { finish(); return; }
      if (more[0].join("\t") === header) more = more.slice(1);
      rows = rows.concat(more); pages++;
      crawl(nextLink(doc));
    }).catch(function () { finish(); });
  }
  crawl(nextLink(document));
})();
