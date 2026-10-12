/* ==========================================================================
   BtoB 仕入れ判定ナビ — app.js（UI・保存・取り込み）
   ========================================================================== */
(function () {
  "use strict";
  var B = window.BTOB;
  var V = "20261013a";
  var $ = function (id) { return document.getElementById(id); };
  var P = new URLSearchParams(location.search);
  var DEBUG = P.get("debug") === "1";
  var SEED_AUC = "data/aucnet_agg_202512.json";
  var SEED_YBA = "data/yba_seed.json";

  /* ---------------- ログ / エラー表示 ---------------- */
  function log() {
    var s = [].slice.call(arguments).map(function (a) { return typeof a === "string" ? a : (function () { try { return JSON.stringify(a); } catch (e) { return "" + a; } })(); }).join(" ");
    if (DEBUG && $("dbg")) { $("dbg").style.display = "block"; $("dbg").textContent += s + "\n"; }
    if (window.console) console.log("[btob]", s);
  }
  function showEsc() { var e = $("escBtn"); if (e) e.classList.add("on"); }
  window.addEventListener("error", function (e) { log("ERROR", e.message, (e.filename || "") + ":" + (e.lineno || "")); showEsc(); });
  window.addEventListener("unhandledrejection", function (e) { log("REJECT", (e.reason && e.reason.message) || ("" + e.reason)); });
  if (DEBUG) { $("dbg").style.display = "block"; $("dbg").textContent = "debug ログ v" + V + "（エラーがあればここに出ます）\n"; }
  $("escBtn").onclick = function () {
    try { var l = $("loader"); if (l) l.style.display = "none"; } catch (e) { }
    try { document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("on"); }); $("v-spread").classList.add("on"); } catch (e) { }
    if (confirm("設定を初期化して読み直しますか？（相場データは残ります）")) { try { localStorage.removeItem("btob_settings"); } catch (e) { } location.reload(); }
  };

  var toastT = null;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2600); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) { return B.esc(s); }
  function todayJST() { var d = new Date(Date.now() + 9 * 3600 * 1000); return d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); }
  function fmtN(n) { return (n == null) ? "—" : Math.round(n).toLocaleString("ja-JP"); }

  /* ---------------- 設定 ---------------- */
  var S = B.deepMerge(B.DEFAULT_SETTINGS, lsGet("btob_settings", {}) || {});
  function saveSettings() { lsSet("btob_settings", S); }

  /* ---------------- 保存（IndexedDB → 失敗時 localStorage） ---------------- */
  var DBN = "btob_navi", STORE = "ds", idb = null, idbFailed = false;
  function openDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("IndexedDB なし"));
      var r; try { r = indexedDB.open(DBN, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "mk" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("open error")); };
      r.onblocked = function () { rej(new Error("blocked")); };
      setTimeout(function () { rej(new Error("IndexedDB timeout")); }, 6000);
    });
  }
  function tx(mode, fn) {
    return new Promise(function (res, rej) {
      if (!idb) return rej(new Error("no db"));
      var t = idb.transaction(STORE, mode), st = t.objectStore(STORE), out;
      try { out = fn(st); } catch (e) { return rej(e); }
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { rej(t.error); };
      t.onabort = function () { rej(t.error || new Error("abort")); };
    });
  }
  function dsPut(obj) {
    if (idb && !idbFailed) return tx("readwrite", function (st) { st.put(obj); }).catch(function (e) { log("idb put fail", e.message); idbFailed = true; return lsSet("btob_ds_" + obj.mk, obj); });
    return Promise.resolve(lsSet("btob_ds_" + obj.mk, obj));
  }
  function dsGetAll() {
    if (idb && !idbFailed) return tx("readonly", function (st) { return st.getAll(); }).catch(function (e) { log("idb getAll fail", e.message); idbFailed = true; return lsAll(); });
    return Promise.resolve(lsAll());
  }
  function lsAll() { return Object.keys(B.MARKETS).map(function (mk) { return lsGet("btob_ds_" + mk, null); }).filter(Boolean); }
  function dsDel(mk) {
    try { localStorage.removeItem("btob_ds_" + mk); } catch (e) { }
    if (idb && !idbFailed) return tx("readwrite", function (st) { st.delete(mk); }).catch(function () { });
    return Promise.resolve();
  }

  /* ---------------- データ状態 ---------------- */
  var DATA = { ecoauc: [], aucnet: [], yba: [], mercari: [] };
  var META = {};
  function metaOf(mk) { if (!META[mk]) META[mk] = { sources: [] }; return META[mk]; }
  // 件数＝個別データの点数＋集計データの元点数（品目集計の件数を合算）
  function countOf(mk) { var n = 0; DATA[mk].forEach(function (r) { if (!r.agg) n++; else if ((r.agg.kind || "cat") === "cat") n += (r.agg.n || 0); }); return n; }
  function counts() { var o = {}; Object.keys(DATA).forEach(function (k) { o[k] = countOf(k); }); return o; }
  function addRecs(mk, recs, src) {
    var have = {}; DATA[mk].forEach(function (r) { have[B.dedupeKey(r)] = 1; });
    var added = 0, tag = "s" + Date.now().toString(36);
    recs.forEach(function (r) { var k = B.dedupeKey(r); if (have[k]) return; have[k] = 1; r.srcTag = tag; DATA[mk].push(r); added++; });
    metaOf(mk).sources.push({ tag: tag, name: src.name || "取り込み", n: src.items != null ? src.items : added, at: new Date().toISOString(), src: src.src || "import" });
    return dsPut({ mk: mk, recs: DATA[mk], meta: META[mk] }).then(function () { return added; });
  }
  function removeSource(mk, tag) {
    DATA[mk] = DATA[mk].filter(function (r) { return r.srcTag !== tag; });
    metaOf(mk).sources = metaOf(mk).sources.filter(function (s) { return s.tag !== tag; });
    var flags = lsGet("btob_seeds", {});
    if (tag.indexOf("seed") === 0) { flags[tag] = "removed"; lsSet("btob_seeds", flags); }
    return dsPut({ mk: mk, recs: DATA[mk], meta: META[mk] });
  }
  function clearMarket(mk) {
    DATA[mk] = []; META[mk] = { sources: [] };
    var flags = lsGet("btob_seeds", {}); Object.keys(flags).forEach(function (k) { if (k.indexOf("seed_" + mk) === 0) flags[k] = "removed"; }); lsSet("btob_seeds", flags);
    return dsDel(mk);
  }
  function loadAll() {
    return dsGetAll().then(function (list) {
      (list || []).forEach(function (o) { if (o && DATA[o.mk] !== undefined) { DATA[o.mk] = o.recs || []; META[o.mk] = o.meta || { sources: [] }; } });
    });
  }
  // 初期データ（オークネット卸リスト2025-12・YBA集計表）
  function loadSeeds() {
    var flags = lsGet("btob_seeds", {});
    var ps = [];
    if (!flags.seed_aucnet_202512) {
      ps.push(fetch(SEED_AUC + "?v=" + V).then(function (r) { if (!r.ok) throw new Error("seed http " + r.status); return r.json(); }).then(function (j) {
        // 集計レコード：[kind, brand, cat, grp, model, rank, n, med, q1, q3, min, max, rankMed]
        var KIND_JA = { model: "型番", catrank: "品目×ランク", cat: "品目", grp: "大分類" };
        var recs = j.rows.map(function (r) {
          var label = r[1] + " " + (r[2] || r[3]) + (r[4] ? " 型番" + r[4] : "") + (r[5] != null ? " ランク" + B.rankLabel(r[5]) : "") + "（" + KIND_JA[r[0]] + "・" + r[6] + "件の集計）";
          return { mk: "aucnet", id: "", brand: r[1], cat: r[2] || "その他", grp: r[3], model: r[4] || "", name: label, rank: r[5], rankRaw: r[5] != null ? B.rankLabel(r[5]) : "", price: r[7], agg: { kind: r[0], n: r[6], med: r[7], q1: r[8], q3: r[9], min: r[10], max: r[11], rankMed: r[12] }, date: "2025-12", src: "seed" };
        });
        return addRecs("aucnet", recs, { name: j.name, src: "seed", items: j.items }).then(function () {
          var m = metaOf("aucnet"); var last = m.sources[m.sources.length - 1]; var oldTag = last.tag; last.tag = "seed_aucnet_202512";
          DATA.aucnet.forEach(function (r) { if (r.srcTag === oldTag) r.srcTag = last.tag; });
          flags.seed_aucnet_202512 = "loaded"; lsSet("btob_seeds", flags);
          return dsPut({ mk: "aucnet", recs: DATA.aucnet, meta: META.aucnet });
        });
      }).catch(function (e) { log("seed aucnet 失敗", e.message); }));
    }
    if (!flags.seed_yba_2023) {
      ps.push(fetch(SEED_YBA + "?v=" + V).then(function (r) { if (!r.ok) throw new Error("seed http " + r.status); return r.json(); }).then(function (j) {
        var recs = j.rows.map(function (r) {
          var cat = B.resolveCat(r[1], "", "");
          return { mk: "yba", id: "", brand: B.canonBrand(r[0]), cat: cat, grp: B.groupOf(cat), model: "", name: B.canonBrand(r[0]) + " " + r[1] + "（品目・" + r[5] + "件の平均）", rank: 3, rankRaw: "B基準", price: r[2], agg: { kind: "cat", min: r[3], max: r[4], n: r[5] }, hi: r[6], lo: r[7], date: "2023-10", src: "seed" };
        });
        var ybaItems = recs.reduce(function (a, r) { return a + (r.agg.n || 0); }, 0);
        return addRecs("yba", recs, { name: j.name, src: "seed", items: ybaItems }).then(function () {
          var m = metaOf("yba"); var last = m.sources[m.sources.length - 1]; var oldTag = last.tag; last.tag = "seed_yba_2023";
          DATA.yba.forEach(function (r) { if (r.srcTag === oldTag) r.srcTag = last.tag; });
          flags.seed_yba_2023 = "loaded"; lsSet("btob_seeds", flags);
          return dsPut({ mk: "yba", recs: DATA.yba, meta: META.yba });
        });
      }).catch(function (e) { log("seed yba 失敗", e.message); }));
    }
    return Promise.all(ps);
  }

  /* ---------------- 共通：ファイル読み ---------------- */
  function decodeBytes(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder("shift_jis").decode(buf); } catch (e2) { return new TextDecoder("utf-8").decode(buf); } }
  }
  var xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = function () { res(window.XLSX); }; s.onerror = function () { xlsxLoading = null; rej(new Error("Excel読込ライブラリを取得できませんでした（通信を確認）。CSVで保存して選び直してください")); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }
  // File → rows[][]
  function readFileRows(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error("ファイルを読めませんでした")); };
      fr.onload = function () {
        var buf = fr.result;
        if (/\.xlsx?$/i.test(file.name)) {
          loadXLSX().then(function (X) {
            var wb = X.read(buf, { type: "array" }); var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
            res(rows.filter(function (r) { return r.some(function (c) { return ("" + c).trim() !== ""; }); }));
          }).catch(rej);
        } else {
          var txt = decodeBytes(buf); res(B.parseDelimited(txt).rows);
        }
      };
      fr.readAsArrayBuffer(file);
    });
  }
  // rows → {header, map, data}
  function analyzeRows(rows) {
    var h = B.detectHeader(rows);
    var map = h >= 0 ? B.autoMap(rows[h]) : B.guessMap(rows);
    return { header: h, map: map, data: h >= 0 ? rows.slice(h + 1) : rows, head: h >= 0 ? rows[h] : null };
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallbackCopy(text); });
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px"; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) { } ta.remove(); return ok;
  }

  /* ---------------- タブ ---------------- */
  function showView(v) {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-v") === v); });
    document.querySelectorAll(".view").forEach(function (s) { s.classList.toggle("on", s.id === "v-" + v); });
    lsSet("btob_tab", v);
    if (v === "data") renderDataStats();
    if (v === "settings") renderSettings();
  }
  $("tabs").addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) showView(b.getAttribute("data-v")); });

  /* ---------------- 共通描画パーツ ---------------- */
  function confCls(c) { return c === "高" ? "h" : c === "中" ? "m" : c === "推定" ? "e" : "l"; }
  function estHTML(est, s) {
    if (!est || !est.ok) return '<span class="pill">相場なし</span><span class="jl">' + esc(est && est.reason ? est.reason : "収録なし") + '</span>';
    var h = '<span class="big">' + B.yen(est.gross) + '</span> <span class="conf ' + confCls(est.conf) + '">' + esc(est.conf) + '</span>';
    h += '<div class="band">帯 ' + B.yen(est.band[0]) + '〜' + B.yen(est.band[1]) + (est.n ? ' ／ ' + est.n + '件' : '') + '</div>';
    h += '<div class="meta"><i>' + esc(est.label) + '</i>' + (est.adj ? '<i>ランク補正 ' + (est.adj > 0 ? "+" : "") + est.adj + '段</i>' : '') + (est.agg ? '<i>集計表（平均）</i>' : '') + '</div>';
    return h;
  }
  function itemHTML(it) {
    var h = '<div class="ttl">' + esc(it.brand || it.brandRaw || "ブランド不明") + '</div><div>' + esc(it.name || "") + '</div>';
    h += '<div class="meta"><i>' + esc(it.cat) + '</i>' + (it.rank != null ? '<i>ランク ' + esc(it.rankRaw || B.rankLabel(it.rank)) + '</i>' : '<i>ランク不明</i>') + (it.model ? '<i>型番 ' + esc(it.model) + '</i>' : '') + (it.id ? '<i>#' + esc(it.id) + '</i>' : '') + '</div>';
    return h;
  }
  function judgeHTML(j) { return '<span class="j ' + j.cls + '">' + esc(j.mark) + '</span><span class="jl">' + esc(j.label) + '</span>'; }

  /* ================= 仕入れ判定 ================= */
  var SP = { items: [], results: [], sort: "judge" };
  function mkHint() {
    var b = $("buyMk").value, s = $("sellMk").value;
    var t = "";
    if (b === s) t = "買う市場と売る市場が同じです。別の市場を選んでください。";
    else {
      t = B.MARKETS[b].short + "で落札 → " + B.MARKETS[s].short + "で販売。";
      t += " 買い側：" + feeDesc(b, "buy") + "／ 売り側：" + feeDesc(s, "sell") + "。相場データ " + B.MARKETS[s].short + " " + fmtN(DATA[s].length) + "件。";
      if (!DATA[s].length) t += " ← 売り先の相場データがありません。「相場データ」タブで取り込んでください。";
    }
    $("mkHint").textContent = t; $("spSellName").textContent = B.MARKETS[s].short;
  }
  function feeDesc(mk, side) {
    var m = S.markets[mk] || {};
    if (side === "buy") {
      if (m.buyTiers) return "手数料 " + m.buyTiers.map(function (t, i) { return (i === m.buyTiers.length - 1 ? "それ以上" : "〜" + fmtN(t[0]) + "円") + " " + fmtN(t[1]) + "円"; }).join("・") + "＋送料" + fmtN(m.shipIn) + "円";
      return "落札料 " + Math.round((m.buyRate || 0) * 100) + "%" + (m.buyMin ? "（最低" + fmtN(m.buyMin) + "円）" : "") + "＋送料" + fmtN(m.shipIn) + "円";
    }
    if (m.sellTiers) return "出品手数料 段階制＋送料" + fmtN(m.shipOut) + "円";
    if (m.shipByGroup) return "販売手数料 " + Math.round((m.sellRate || 0) * 100) + "%＋サイズ別送料";
    return "成約料 " + Math.round((m.sellRate || 0) * 100) + "%" + (m.sellMin ? "（最低" + fmtN(m.sellMin) + "円）" : "") + "＋送料" + fmtN(m.shipOut) + "円";
  }
  $("buyMk").onchange = function () { mkHint(); if (SP.items.length) runSpread(); };
  $("sellMk").onchange = function () { mkHint(); if (SP.items.length) runSpread(); };
  $("spTax").onchange = function () { renderSpread(); };
  $("spSort").onchange = function () { SP.sort = this.value; renderSpread(); };

  var SP_SAMPLE = "ブランド\t商品名\tランク\t型番\tスタート価格\nCHANEL\tマトラッセ チェーンショルダーバッグ ラムスキン\tB\tA01112\t80000\nルイヴィトン\tジッピーウォレット モノグラム 長財布\tA\tM41895\t20000\nHERMES\tカレ90 シルクスカーフ\tA\t\t8000\nGUCCI\tGGマーモント 長財布\tC\t\t5000\nDIOR\tトロッター ショルダーバッグ ヴィンテージ\tB\t\t30000\nアニアリ\tレザー ショルダーバッグ\tB\t\t3000";
  $("spSample").onclick = function () { $("spList").value = SP_SAMPLE; toast("サンプルを入れました。「判定する」を押してください"); };
  $("spClear").onclick = function () { $("spList").value = ""; SP.items = []; SP.results = []; renderSpread(); };
  $("spFile").onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    readFileRows(f).then(function (rows) { $("spList").value = B.toTSV(rows); toast(f.name + " を読みました（" + rows.length + "行）"); runSpread(); }).catch(function (e) { toast(e.message); });
    this.value = "";
  };
  $("spRun").onclick = runSpread;
  function runSpread() {
    var txt = $("spList").value;
    var parsed = B.parseDelimited(txt);
    if (!parsed.rows.length) { toast("リストを貼り付けてください"); return; }
    var an = analyzeRows(parsed.rows);
    var buyMk = $("buyMk").value, sellMk = $("sellMk").value;
    if (buyMk === sellMk) { toast("買う市場と売る市場を別にしてください"); return; }
    var off = (S.markets[buyMk] && S.markets[buyMk].rankOffset) || 0;
    var prevBids = {}; SP.results.forEach(function (r) { if (r.userBid != null) prevBids[r.idx] = r.userBid; });
    SP.items = an.data.map(function (row, i) {
      var it = B.makeItem(row, an.map); it.idx = i;
      if (it.rank != null) it.rank += off; // 買い側のランク補正を共通尺度へ
      return it;
    }).filter(function (it) { return it.brand || it.name; });
    SP.results = SP.items.map(function (it) {
      var bid = prevBids[it.idx] != null ? prevBids[it.idx] : (it.price != null && it.price > 0 ? it.price : null);
      var r = B.evaluate(it, buyMk, bid, sellMk, DATA, S); r.idx = it.idx; r.userBid = bid; return r;
    });
    SP.map = an.map; SP.head = an.head;
    renderSpread();
    var noBrand = SP.items.filter(function (it) { return !it.brand; }).length;
    toast(SP.items.length + "点を判定しました" + (noBrand ? "（ブランド不明 " + noBrand + "点）" : ""));
  }
  function sortedResults() {
    var arr = SP.results.slice();
    var order = { best: 0, good: 1, thin: 2, info: 3, bad: 4, na: 5 };
    if (SP.sort === "judge") arr.sort(function (a, b) { var d = order[a.judge.cls] - order[b.judge.cls]; if (d) return d; return (b.profit || b.maxBid || 0) - (a.profit || a.maxBid || 0); });
    else if (SP.sort === "profit") arr.sort(function (a, b) { return ((b.profit != null ? b.profit : -1e12)) - ((a.profit != null ? a.profit : -1e12)); });
    return arr;
  }
  function renderSpread() {
    var tb = $("spTable").querySelector("tbody");
    if (!SP.results.length) { $("spWrap").style.display = "none"; $("spSummary").style.display = "none"; $("spActions").style.display = "none"; tb.innerHTML = ""; return; }
    var tax = $("spTax").checked;
    var arr = sortedResults();
    var html = arr.map(function (r, i) {
      var it = r.item;
      var h = "<tr data-idx='" + r.idx + "'>";
      h += "<td>" + (i + 1) + "</td><td style='min-width:200px'>" + itemHTML(it) + "</td>";
      h += "<td style='min-width:190px'>" + estHTML(r.est, S) + "</td>";
      if (r.est.ok) {
        h += "<td class='num'><span class='big'>" + B.yen(r.net) + "</span><div class='band'>下限 " + B.yen(r.netLo) + "</div></td>";
        h += "<td class='num'><span class='big'>" + B.yen(r.maxBid) + "</span><div class='band'>目標ROI " + Math.round(S.targetRoi * 100) + "%／帯下限なら " + B.yen(r.maxBidLo) + "</div></td>";
        h += "<td class='num'><input class='bid' inputmode='numeric' value='" + (r.userBid != null ? r.userBid : (r.bid != null ? r.bid : "")) + "' placeholder='税抜'>" + (r.bid != null && r.bidIsStart ? "<div class='band'>スタート価格で仮判定</div>" : "") + "</td>";
        if (r.profit != null) h += "<td class='num'><span class='big'>" + B.yen(r.profit) + "</span><div class='band'>ROI " + B.pct(r.roi) + "／仕入総額 " + B.yen(r.landed) + (tax ? "（税込 " + B.yen(r.landedTax) + "）" : "") + "</div></td>";
        else h += "<td class='num'><span class='band'>入札額を入れると出ます</span></td>";
      } else {
        h += "<td class='num'>—</td><td class='num'>—</td><td class='num'>—</td><td class='num'>—</td>";
      }
      h += "<td>" + judgeHTML(r.judge) + "</td></tr>";
      return h;
    }).join("");
    tb.innerHTML = html;
    $("spWrap").style.display = "block"; $("spActions").style.display = "flex";
    tb.querySelectorAll("input.bid").forEach(function (inp) {
      inp.onchange = function () {
        var tr = inp.closest("tr"); var idx = +tr.getAttribute("data-idx");
        var r = SP.results.filter(function (x) { return x.idx === idx; })[0]; if (!r) return;
        var v = B.num(inp.value); r.userBid = v;
        var nr = B.evaluate(r.item, r.buyMk, v, r.sellMk, DATA, S); nr.idx = r.idx; nr.userBid = v;
        SP.results[SP.results.indexOf(r)] = nr; renderSpread();
      };
    });
    // サマリー
    var n = SP.results.length, best = 0, good = 0, none = 0, sumMax = 0, sumProfit = 0, withBid = 0, sumLanded = 0;
    SP.results.forEach(function (r) { if (!r.est.ok) { none++; return; } if (r.judge.cls === "best") best++; if (r.judge.cls === "good") good++; if (r.judge.cls === "best" || r.judge.cls === "good" || r.judge.cls === "info") sumMax += r.maxBid || 0; if (r.profit != null) { withBid++; sumProfit += r.profit; sumLanded += r.landed; } });
    $("spSummary").innerHTML =
      tile("判定した点数", n + "<small> 点</small>") + tile("◎ 買い", best + "<small> 点</small>", true) + tile("○ 条件次第", good + "<small> 点</small>") +
      tile("上限入札額の合計（◎○）", B.yen(sumMax)) + tile("想定粗利の合計（入札額あり " + withBid + "点）", B.yen(sumProfit) + (sumLanded ? "<small> ROI " + B.pct(sumProfit / sumLanded) + "</small>" : "")) + tile("相場なし", none + "<small> 点</small>");
    $("spSummary").style.display = "grid";
  }
  function tile(l, v, hi) { return "<div class='tile" + (hi ? " hi" : "") + "'><div class='l'>" + l + "</div><div class='v'>" + v + "</div></div>"; }
  function spreadRows() {
    var head = ["受付番号", "ブランド", "商品名", "品目", "ランク", "型番", "仕入れ市場", "販売市場", "相場中央値", "帯下限", "帯上限", "件数", "根拠", "信頼", "手残り", "上限入札額", "入札額", "仕入総額（税抜）", "粗利", "ROI", "判定"];
    var rows = [head];
    sortedResults().forEach(function (r) {
      var it = r.item, e = r.est;
      rows.push([it.id, it.brand, it.name, it.cat, it.rankRaw || B.rankLabel(it.rank), it.model, B.MARKETS[r.buyMk].short, B.MARKETS[r.sellMk].short,
        e.ok ? e.gross : "", e.ok ? e.band[0] : "", e.ok ? e.band[1] : "", e.ok ? e.n : "", e.ok ? e.label : "相場なし", e.ok ? e.conf : "",
        e.ok ? r.net : "", e.ok ? r.maxBid : "", r.bid != null ? r.bid : "", r.landed != null ? r.landed : "", r.profit != null ? r.profit : "", r.roi != null ? Math.round(r.roi * 100) + "%" : "", r.judge.mark + " " + r.judge.label]);
    });
    return rows;
  }
  function spreadSheetTSV() {
    // ひかるさんの「オークネット入札シート」列順
    var head = ["写真", "受付番号", "カテゴリー", "ブランド名", "スタート価格", "入札価格", "メルカリ相場", "リンク", "用途", "入札日", "落札結果", "落札価格", "備考"];
    var rows = [head], today = todayJST();
    sortedResults().forEach(function (r) {
      var it = r.item, e = r.est;
      var bid = r.userBid != null ? r.userBid : (e.ok ? r.maxBid : "");
      var memo = e.ok ? (B.MARKETS[r.sellMk].short + "相場 " + B.yen(e.gross) + "（" + e.n + "件・" + e.conf + "）手残り" + B.yen(r.net) + " 判定" + r.judge.mark) : "相場なし";
      rows.push(["", it.id, it.shape || it.cat, it.brand || it.brandRaw, it.start != null ? it.start : "", bid, "", it.url || "", "", today, "", "", memo + (it.name ? " ／ " + it.name : "")]);
    });
    return B.toTSV(rows);
  }
  $("spCsv").onclick = function () { if (!SP.results.length) return; download("btob_shiire_" + todayJST().replace(/\//g, "") + ".csv", B.toCSV(spreadRows())); toast("CSVを書き出しました"); };
  $("spCopySheet").onclick = function () { if (!SP.results.length) return; copyText(spreadSheetTSV()).then(function (ok) { toast(ok ? "入札シート形式でコピーしました。スプレッドシートに貼り付けてください" : "コピーできませんでした"); }); };

  // 単品
  function fillCats() { var sel = $("sgCat"); sel.innerHTML = "<option value=''>自動判定</option>" + B.CAT_LIST.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join(""); }
  $("sgRun").onclick = function () {
    var txt = $("sgBrand").value.trim(); if (!txt) { toast("ブランドと商品名を入れてください"); $("sgBrand").focus(); return; }
    var buyMk = $("buyMk").value, sellMk = $("sellMk").value; if (buyMk === sellMk) { toast("買う市場と売る市場を別にしてください"); return; }
    var brand = B.brandFromText(txt) || B.canonBrand(txt.split(/\s/)[0]);
    var cat = $("sgCat").value || B.resolveCat("", txt, "");
    var rank = B.rankScore($("sgRank").value); if (rank != null) rank += (S.markets[buyMk].rankOffset || 0);
    var it = { id: "", brand: brand, brandRaw: txt, name: txt, cat: cat, grp: B.groupOf(cat), model: B.modelOf(txt), rank: rank, rankRaw: $("sgRank").value, start: null };
    var bid = B.num($("sgPrice").value);
    var r = B.evaluate(it, buyMk, bid, sellMk, DATA, S);
    var h = "<div class='tw'><table><thead><tr><th>商品</th><th>販売相場（" + esc(B.MARKETS[sellMk].short) + "）</th><th class='num'>手残り</th><th class='num'>上限入札額</th><th class='num'>粗利 / ROI</th><th>判定</th></tr></thead><tbody><tr>";
    h += "<td style='min-width:200px'>" + itemHTML(it) + "</td><td style='min-width:190px'>" + estHTML(r.est, S) + "</td>";
    if (r.est.ok) {
      h += "<td class='num'><span class='big'>" + B.yen(r.net) + "</span></td><td class='num'><span class='big'>" + B.yen(r.maxBid) + "</span><div class='band'>帯下限なら " + B.yen(r.maxBidLo) + "</div></td>";
      h += r.profit != null ? "<td class='num'><span class='big'>" + B.yen(r.profit) + "</span><div class='band'>ROI " + B.pct(r.roi) + "／仕入総額 " + B.yen(r.landed) + "</div></td>" : "<td class='num'><span class='band'>入札額を入れると出ます</span></td>";
    } else h += "<td class='num'>—</td><td class='num'>—</td><td class='num'>—</td>";
    h += "<td>" + judgeHTML(r.judge) + "</td></tr></tbody></table></div>";
    if (r.est.ok && r.est.comps && r.est.comps.length) {
      h += "<p class='hint' style='margin-top:8px'>根拠にした落札例（最大8件）：" + r.est.comps.slice(0, 8).map(function (c) { return esc((c.name || c.cat) + (c.rankRaw ? "／" + c.rankRaw : "")) + " " + B.yen(c.price); }).join("　｜　") + "</p>";
    }
    $("sgOut").innerHTML = h;
  };

  /* ================= 出口判定 ================= */
  var EX = { items: [], results: [] };
  var EX_SAMPLE = "番号\t商品名\t状態\t仕入単価\t予想売価\n1\tルイヴィトン　ジッピーウォレット　モノグラム　長財布　M81279　ピンク\t2.未使用に近い\t54000\t90000\n3\tシャネル　折財布　ラムスキン\t2.未使用に近い\t54000\t90000\n6\tケイトスペード　ミニウォレット　花\t2.未使用に近い\t4488\t7480\n58\tシャネル 長財布 ココボタン　黒　キャビアスキン\t3.目立った傷汚れなし\t10860\t18100\n60\tバーバリー　コインケース\t2.未使用に近い\t6480\t10800";
  $("exSample").onclick = function () { $("exList").value = EX_SAMPLE; toast("サンプルを入れました。「出口を判定する」を押してください"); };
  $("exClear").onclick = function () { $("exList").value = ""; EX.items = []; EX.results = []; renderExit(); };
  $("exFile").onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    readFileRows(f).then(function (rows) { $("exList").value = B.toTSV(rows); toast(f.name + " を読みました（" + rows.length + "行）"); runExit(); }).catch(function (e) { toast(e.message); });
    this.value = "";
  };
  $("exRun").onclick = runExit;
  function runExit() {
    var parsed = B.parseDelimited($("exList").value);
    if (!parsed.rows.length) { toast("在庫リストを貼り付けてください"); return; }
    var an = analyzeRows(parsed.rows);
    EX.items = an.data.map(function (row, i) { var it = B.makeItem(row, an.map); it.idx = i; return it; }).filter(function (it) { return it.brand || it.name; });
    EX.results = EX.items.map(function (it) { return B.exitCompare(it, DATA, S); });
    renderExit();
    toast(EX.items.length + "点の出口を判定しました");
  }
  function renderExit() {
    var tb = $("exTable").querySelector("tbody");
    if (!EX.results.length) { $("exWrap").style.display = "none"; $("exSummary").style.display = "none"; $("exActions").style.display = "none"; tb.innerHTML = ""; return; }
    var sumCost = 0, sumAuc = 0, sumMer = 0, nAuc = 0, nMer = 0, immediate = 0;
    tb.innerHTML = EX.results.map(function (r, i) {
      var it = r.item;
      if (it.cost != null) sumCost += it.cost;
      if (r.aucNet != null) { sumAuc += r.aucNet; nAuc++; }
      if (r.merNet != null) { sumMer += r.merNet; nMer++; }
      if (r.advice.cls === "best") immediate++;
      var h = "<tr><td>" + (i + 1) + "</td><td style='min-width:200px'>" + itemHTML(it) + "</td>";
      h += "<td class='num'>" + (it.cost != null ? "<span class='big'>" + B.yen(it.cost) + "</span>" : "<span class='band'>未入力</span>") + "</td>";
      if (r.auc && r.auc.ok) {
        h += "<td style='min-width:200px'>想定落札 <span class='big'>" + B.yen(r.auc.gross) + "</span> <span class='conf " + confCls(r.auc.conf) + "'>" + esc(r.auc.conf) + "</span><div class='band'>帯 " + B.yen(r.auc.band[0]) + "〜" + B.yen(r.auc.band[1]) + (r.auc.n ? "／" + r.auc.n + "件" : "") + "</div>";
        h += "<div>手残り <b>" + B.yen(r.aucNet) + "</b>" + (r.aucProfit != null ? " → 粗利 <b class='" + (r.aucProfit >= 0 ? "ok" : "ng") + "'>" + B.yen(r.aucProfit) + "</b>（ROI " + B.pct(r.aucRoi) + "）" : "") + "</div><div class='meta'><i>" + esc(r.auc.label) + "</i></div></td>";
      } else h += "<td><span class='pill'>相場なし</span><div class='band'>予想売価を入れると推定します</div></td>";
      if (r.merGross != null) {
        h += "<td style='min-width:180px'>想定売値 <span class='big'>" + B.yen(r.merGross) + "</span><div class='band'>" + esc(r.merSrc) + "／手数料10%＋送料</div><div>手残り <b>" + B.yen(r.merNet) + "</b>" + (r.merProfit != null ? " → 粗利 <b class='" + (r.merProfit >= 0 ? "ok" : "ng") + "'>" + B.yen(r.merProfit) + "</b>（ROI " + B.pct(r.merRoi) + "）" : "") + "</div></td>";
      } else h += "<td><span class='pill'>相場なし</span></td>";
      h += "<td style='min-width:180px'><span class='j " + r.advice.cls + "'>" + ({ best: "即", good: "粘", bad: "×", na: "—", info: "？" }[r.advice.cls] || "—") + "</span><span class='jl' style='white-space:normal'>" + esc(r.advice.text) + "</span></td></tr>";
      return h;
    }).join("");
    $("exWrap").style.display = "block"; $("exActions").style.display = "flex";
    $("exSummary").innerHTML = tile("点数", EX.results.length + "<small> 点</small>") + tile("仕入総額", B.yen(sumCost)) + tile("業者オクに全部流した手残り（" + nAuc + "点分）", B.yen(sumAuc) + (sumCost && nAuc === EX.results.length ? "<small> 粗利 " + B.yen(sumAuc - sumCost) + "</small>" : ""), true) + tile("メルカリで全部売った手残り（" + nMer + "点分）", B.yen(sumMer) + (sumCost && nMer === EX.results.length ? "<small> 粗利 " + B.yen(sumMer - sumCost) + "</small>" : "")) + tile("即換金OK", immediate + "<small> 点</small>");
    $("exSummary").style.display = "grid";
  }
  function exitRows() {
    var rows = [["番号", "ブランド", "商品名", "品目", "状態", "仕入単価", "業者オク想定落札", "業者オク手残り", "業者オク粗利", "業者オクROI", "根拠", "メルカリ想定売値", "メルカリ手残り", "メルカリ粗利", "おすすめ"]];
    EX.results.forEach(function (r) { var it = r.item; rows.push([it.id, it.brand, it.name, it.cat, it.rankRaw, it.cost != null ? it.cost : "", r.auc && r.auc.ok ? r.auc.gross : "", r.aucNet != null ? r.aucNet : "", r.aucProfit != null ? r.aucProfit : "", r.aucRoi != null ? Math.round(r.aucRoi * 100) + "%" : "", r.auc && r.auc.ok ? r.auc.label + "（" + r.auc.conf + "）" : "相場なし", r.merGross != null ? r.merGross : "", r.merNet != null ? r.merNet : "", r.merProfit != null ? r.merProfit : "", r.advice.text]); });
    return rows;
  }
  $("exCsv").onclick = function () { if (!EX.results.length) return; download("btob_deguchi_" + todayJST().replace(/\//g, "") + ".csv", B.toCSV(exitRows())); toast("CSVを書き出しました"); };

  /* ================= 相場データ ================= */
  var IMP = { mk: "ecoauc", rows: [], an: null, name: "" };
  $("dmMk").addEventListener("click", function (e) {
    var b = e.target.closest(".mkchip"); if (!b) return;
    IMP.mk = b.getAttribute("data-mk");
    document.querySelectorAll("#dmMk .mkchip").forEach(function (x) { x.classList.toggle("on", x === b); });
    if (IMP.rows.length) renderPreview();
  });
  $("dmFile").onchange = function () {
    var f = this.files && this.files[0]; if (!f) return;
    readFileRows(f).then(function (rows) { IMP.rows = rows; IMP.name = f.name; IMP.an = analyzeRows(rows); renderPreview(); toast(f.name + " を読みました（" + rows.length + "行）"); }).catch(function (e) { toast(e.message); });
    this.value = "";
  };
  $("dmParse").onclick = function () {
    var parsed = B.parseDelimited($("dmText").value);
    if (!parsed.rows.length) { toast("表を貼り付けてください"); return; }
    IMP.rows = parsed.rows; IMP.name = "貼り付け " + todayJST(); IMP.an = analyzeRows(parsed.rows); renderPreview();
  };
  var IMP_ROLES = ["brand", "name", "shape", "genre", "model", "rank", "ext", "inn", "price", "start", "date", "id", "result"];
  function renderPreview() {
    var an = IMP.an, rows = IMP.rows; var box = $("dmPreview");
    if (!rows.length) { box.innerHTML = ""; return; }
    var ncol = 0; rows.forEach(function (r) { if (r.length > ncol) ncol = r.length; });
    var colName = function (c) { return an.head && an.head[c] ? B.nfkc(an.head[c]).slice(0, 18) : "列" + (c + 1); };
    var h = "<div class='card' style='margin-top:12px;padding:14px'><h2><span class='tag'>確認</span>" + esc(IMP.name) + "<small>" + an.data.length + "行" + (an.header >= 0 ? "（ヘッダー行あり）" : "（ヘッダー無し・推定）") + "／取り込み先：" + esc(B.MARKETS[IMP.mk].short) + "</small></h2>";
    h += "<div class='map'>" + IMP_ROLES.map(function (role) {
      var opts = "<option value=''>（使わない）</option>"; for (var c = 0; c < ncol; c++) opts += "<option value='" + c + "'" + (an.map[role] === c ? " selected" : "") + ">" + esc(colName(c)) + "</option>";
      return "<div class='f'><label>" + esc(B.ROLE_LABEL[role]) + "</label><select data-role='" + role + "'>" + opts + "</select></div>";
    }).join("") + "</div>";
    var isOroshi = an.head && an.map.price != null && /卸/.test(an.head[an.map.price] || "");
    h += "<div class='btns'><label class='sw'><input type='checkbox' id='dmOroshi'" + (isOroshi ? " checked" : "") + "> 価格は卸価格（落札相場×" + (S.markets.aucnet.oroshiRatio || 1.1) + "）→ 割り戻して取り込む</label>";
    h += "<label class='sw'><input type='checkbox' id='dmFallbackStart'> 価格が無い行はスタート価格を使う</label></div>";
    // プレビュー
    h += "<div class='tw'><table><thead><tr>" + Array.apply(null, Array(Math.min(ncol, 12))).map(function (_, c) { return "<th>" + esc(colName(c)) + "</th>"; }).join("") + "</tr></thead><tbody>";
    an.data.slice(0, 5).forEach(function (r) { h += "<tr>" + Array.apply(null, Array(Math.min(ncol, 12))).map(function (_, c) { return "<td>" + esc(("" + (r[c] == null ? "" : r[c])).slice(0, 24)) + "</td>"; }).join("") + "</tr>"; });
    h += "</tbody></table></div>";
    h += "<div class='btns'><button class='btn' id='dmImport' type='button'>この内容で " + esc(B.MARKETS[IMP.mk].short) + " に取り込む</button><span class='hint' id='dmTest' style='margin:0'></span></div></div>";
    box.innerHTML = h;
    box.querySelectorAll("select[data-role]").forEach(function (sel) { sel.onchange = function () { var v = sel.value; if (v === "") delete an.map[sel.getAttribute("data-role")]; else an.map[sel.getAttribute("data-role")] = +v; testMap(); }; });
    $("dmImport").onclick = doImport;
    testMap();
  }
  function testMap() {
    var an = IMP.an; if (!an) return;
    var t = B.toRecords(an.data.slice(0, 200), an.map, IMP.mk, { priceDivisor: $("dmOroshi") && $("dmOroshi").checked ? (S.markets.aucnet.oroshiRatio || 1.1) : null, fallbackStart: $("dmFallbackStart") && $("dmFallbackStart").checked });
    var brands = {}; t.recs.forEach(function (r) { brands[r.brand] = (brands[r.brand] || 0) + 1; });
    var top = Object.keys(brands).sort(function (a, b) { return brands[b] - brands[a]; }).slice(0, 4).join("・");
    $("dmTest").textContent = "先頭200行のうち " + t.recs.length + "行が有効（価格なし/不成立 " + t.skipped + "行）。ブランド例：" + (top || "—");
  }
  function doImport() {
    var an = IMP.an; if (!an) return;
    if (an.map.price == null) { toast("価格の列を選んでください"); return; }
    var btn = $("dmImport"); btn.disabled = true;
    var t = B.toRecords(an.data, an.map, IMP.mk, { priceDivisor: $("dmOroshi").checked ? (S.markets.aucnet.oroshiRatio || 1.1) : null, fallbackStart: $("dmFallbackStart").checked, src: "import" });
    if (!t.recs.length) { toast("有効な行がありません。価格・ブランドの列を確認してください"); btn.disabled = false; return; }
    var mk = IMP.mk, name = IMP.name;
    // 先に画面を片付ける（保存完了を待つ間に次の貼り付けを始めても消さない）
    IMP.rows = []; IMP.an = null; $("dmPreview").innerHTML = ""; $("dmText").value = "";
    toast("保存中…");
    addRecs(mk, t.recs, { name: name, src: "import" }).then(function (added) {
      toast(B.MARKETS[mk].short + " に " + added + "件を追加しました（重複 " + (t.recs.length - added) + "件は除外）");
      renderDataStats(); updateBadge(); mkHint();
    }).catch(function (e) { toast("保存に失敗：" + e.message); });
  }
  function renderDataStats() {
    var h = Object.keys(B.MARKETS).map(function (mk) {
      var recs = DATA[mk], m = metaOf(mk);
      var brands = {}; recs.forEach(function (r) { brands[r.brand] = 1; });
      var x = "<div class='ds'><b>" + esc(B.MARKETS[mk].name) + "</b><div class='n'>" + fmtN(countOf(mk)) + "<small> 件 ／ " + Object.keys(brands).length + " ブランド</small></div><ul>";
      if (!m.sources.length) x += "<li>データなし。下から取り込んでください</li>";
      m.sources.forEach(function (s) { x += "<li><span>" + (s.src === "seed" ? "<span class='pill seed'>初期</span> " : "<span class='pill src'>取込</span> ") + esc(s.name) + " " + fmtN(s.n) + "件 <small>" + esc((s.at || "").slice(0, 10)) + "</small></span><button type='button' data-del='" + mk + "|" + s.tag + "'>削除</button></li>"; });
      x += "</ul>" + (recs.length ? "<div class='btns' style='margin-top:8px'><button class='btn sub sm' type='button' data-clear='" + mk + "'>この市場を全消去</button></div>" : "") + "</div>";
      return x;
    }).join("");
    $("dmStats").innerHTML = h;
    $("dmStats").querySelectorAll("button[data-del]").forEach(function (b) { b.onclick = function () { var p = b.getAttribute("data-del").split("|"); if (!confirm("この取り込み分を削除しますか？")) return; removeSource(p[0], p[1]).then(function () { renderDataStats(); updateBadge(); mkHint(); toast("削除しました"); }); }; });
    $("dmStats").querySelectorAll("button[data-clear]").forEach(function (b) { b.onclick = function () { var mk = b.getAttribute("data-clear"); if (!confirm(B.MARKETS[mk].short + " の相場データを全て消しますか？")) return; clearMarket(mk).then(function () { renderDataStats(); updateBadge(); mkHint(); toast("消去しました"); }); }; });
  }
  $("dmExport").onclick = function () {
    var out = { v: V, at: new Date().toISOString(), settings: S, data: DATA, meta: META };
    download("btob_navi_backup_" + todayJST().replace(/\//g, "") + ".json", JSON.stringify(out), "application/json"); toast("バックアップを書き出しました");
  };
  $("dmImportJson").onchange = function () {
    var f = this.files && this.files[0]; if (!f) return; var fr = new FileReader();
    fr.onload = function () {
      try {
        var j = JSON.parse(fr.result); if (!j.data) throw new Error("形式が違います");
        var ps = Object.keys(j.data).map(function (mk) { if (DATA[mk] === undefined) return null; return addRecs(mk, j.data[mk], { name: "バックアップ " + f.name, src: "import" }); }).filter(Boolean);
        Promise.all(ps).then(function (ns) { toast("読み込みました（追加 " + ns.reduce(function (a, b) { return a + b; }, 0) + "件）"); renderDataStats(); updateBadge(); mkHint(); });
      } catch (e) { toast("読み込めませんでした：" + e.message); }
    };
    fr.readAsText(f); this.value = "";
  };
  // ブックマークレット：ページ内で一番大きい表をTSVでコピー
  (function () {
    var code = "(function(){var ts=[].slice.call(document.querySelectorAll('table'));if(!ts.length){alert('表が見つかりません');return;}ts.sort(function(a,b){return b.rows.length-a.rows.length;});var t=ts[0],out=[];for(var i=0;i<t.rows.length;i++){var r=t.rows[i],c=[];for(var j=0;j<r.cells.length;j++){c.push((r.cells[j].innerText||'').replace(/[\\t\\r\\n]+/g,' ').trim());}out.push(c.join('\\t'));}var s=out.join('\\n');function done(){alert('表をコピーしました（'+t.rows.length+'行）。BtoBナビの「相場データ」に貼り付けてください');}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(s).then(done,function(){prompt('コピーできない時はここから全選択→コピー',s);});}else{prompt('全選択→コピー',s);}})();";
    $("dmBookmarklet").setAttribute("href", "javascript:" + encodeURIComponent(code));
    $("dmBookmarklet").onclick = function (e) { if (location.protocol.indexOf("http") === 0) { e.preventDefault(); toast("このリンクをブックマークバーへドラッグして使います"); } };
  })();

  /* ================= 設定 ================= */
  var SPEC = [
    { sec: "判定のしきい値", items: [["targetRoi", "目標ROI（上限入札額の基準）", "%", ""], ["minProfit", "◎ に必要な粗利", "yen", ""], ["okRoi", "○ のROI下限", "%", ""], ["okProfit", "○ の粗利下限", "yen", ""], ["rankStep", "ランク1段の価格差（倍率）", "x", "オークネット談：B→Cで約1割下がる"], ["tax", "消費税率", "%", ""]] },
    { sec: "エコオク", items: [["markets.ecoauc.shipIn", "入荷送料／点", "yen", "仮。送料は翌月請求（規約）"], ["markets.ecoauc.shipOut", "出品時の送料／点", "yen", "仮"], ["markets.ecoauc.extraSell", "出品時その他費用／点", "yen", "撮影手数料400円など（規約）"], ["markets.ecoauc.rankOffset", "ランク補正（段）", "n", "他市場と同じ基準なら0"]], tiers: "ecoauc" },
    { sec: "オークネット", items: [["markets.aucnet.buyRate", "落札料（買う時）", "%", "実績：計算書で4%（33,000円→1,320円）"], ["markets.aucnet.buyMin", "落札料の最低額", "yen", "実績：1,000円の品で500円"], ["markets.aucnet.sellRate", "成約料（売る時）", "%", "プレミアム3%／レギュラー5%（公式）"], ["markets.aucnet.sellMin", "成約料の最低額", "yen", "仮"], ["markets.aucnet.shipIn", "入荷送料／点", "yen", "実績：配送費1,150円/回を点数割り"], ["markets.aucnet.shipOut", "出品送料／点", "yen", "仮"], ["markets.aucnet.rankOffset", "ランク補正（段）", "n", "評価が厳しいので+1でCを他市場のB扱い"], ["markets.aucnet.oroshiRatio", "卸価格→落札相場の換算（÷）", "x", "卸単価＝落札価格の約1.1倍（オークネット談）"]] },
    { sec: "YBA", items: [["markets.yba.buyRate", "買い手数料", "%", "未確認（0）"], ["markets.yba.buyMin", "買い手数料の最低額", "yen", ""], ["markets.yba.sellRate", "出品手数料", "%", "未確認"], ["markets.yba.shipIn", "入荷送料／点", "yen", "持ち帰りなら0"], ["markets.yba.shipOut", "出品送料／点", "yen", ""]] },
    { sec: "メルカリ（参考）", items: [["markets.mercari.sellRate", "販売手数料", "%", "10%"], ["markets.mercari.shipByGroup.バッグ", "送料：バッグ", "yen", ""], ["markets.mercari.shipByGroup.靴", "送料：靴", "yen", ""], ["markets.mercari.shipByGroup.アパレル", "送料：アパレル", "yen", ""], ["markets.mercari.shipByGroup.財布・小物", "送料：財布・小物", "yen", "ネコポス215円"], ["markets.mercari.shipByGroup.アクセサリー", "送料：アクセサリー", "yen", ""], ["markets.mercari.shipByGroup.服飾小物", "送料：服飾小物", "yen", ""], ["markets.mercari.shipByGroup.時計", "送料：時計", "yen", ""]] },
    { sec: "出口判定（Re:che）", items: [["exitPrefer", "業者オク手残りがメルカリの何%以上なら即換金", "%", "回転を優先する度合い"], ["exitTier1", "換算係数：HERMES/CHANEL/LV/ROLEX/CARTIER", "x", "実データが無い時だけ使用"], ["exitTier2", "換算係数：GUCCI/PRADA/DIOR/CELINE 等", "x", ""], ["exitTier3", "換算係数：その他ブランド", "x", "入札シートの実例：メルカリ相場の4〜6割"]] },
    { sec: "固定費の配賦（任意）", items: [["fixed.aucnetMonthly", "オークネット月額", "yen", "実績：16,000円（入札シートのメモ）"], ["fixed.ecoaucYearly", "エコオク年会費", "yen", "請求書：20,000円（＋入会金30,000円）"], ["fixed.monthlyItems", "月の仕入れ点数", "n", "0なら配賦しない。入れると1点あたり固定費を仕入総額に足す"]] }
  ];
  function getPath(o, p) { return p.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split("."); var t = o; for (var i = 0; i < ks.length - 1; i++) { if (t[ks[i]] == null) t[ks[i]] = {}; t = t[ks[i]]; } t[ks[ks.length - 1]] = v; }
  function renderSettings() {
    var h = SPEC.map(function (sec) {
      var x = "<h2 style='margin-top:14px'><span class='tag'>" + esc(sec.sec) + "</span></h2><div class='sgrid'>";
      x += sec.items.map(function (it) {
        var v = getPath(S, it[0]); var disp = it[2] === "%" ? Math.round(v * 1000) / 10 : v;
        return "<div class='f'><label>" + esc(it[1]) + (it[2] === "%" ? "（%）" : it[2] === "yen" ? "（円）" : it[2] === "x" ? "（倍）" : "") + "</label><input data-s='" + it[0] + "' data-t='" + it[2] + "' inputmode='decimal' value='" + esc(disp) + "'>" + (it[3] ? "<small>" + esc(it[3]) + "</small>" : "") + "</div>";
      }).join("");
      x += "</div>";
      if (sec.tiers === "ecoauc") {
        x += "<div class='sgrid'><div class='f'><label>買い手数料の段階（上限金額 手数料／1行）</label><textarea data-tiers='markets.ecoauc.buyTiers' style='min-height:92px'>" + tiersText(S.markets.ecoauc.buyTiers) + "</textarea><small>規約：1万円まで500／5万円未満1,000／5万円以上2,000（税別）。10万円以上は仮</small></div>";
        x += "<div class='f'><label>出品手数料の段階（上限金額 手数料／1行）</label><textarea data-tiers='markets.ecoauc.sellTiers' style='min-height:92px'>" + tiersText(S.markets.ecoauc.sellTiers) + "</textarea></div></div>";
      }
      return x;
    }).join("");
    $("stForm").innerHTML = h;
  }
  function tiersText(t) { return t.map(function (p) { return (p[0] >= 1e11 ? "それ以上" : p[0]) + " " + p[1]; }).join("\n"); }
  function parseTiers(txt) {
    var out = []; txt.split(/\n/).forEach(function (l) { var m = l.trim().match(/^(それ以上|以上|∞|\d[\d,]*)\s+(\d[\d,]*)/); if (!m) return; out.push([/\d/.test(m[1]) ? +m[1].replace(/,/g, "") : 1e12, +m[2].replace(/,/g, "")]); });
    out.sort(function (a, b) { return a[0] - b[0]; }); return out.length ? out : null;
  }
  $("stSave").onclick = function () {
    document.querySelectorAll("#stForm input[data-s]").forEach(function (inp) {
      var v = B.num(inp.value); if (v == null) return;
      if (inp.getAttribute("data-t") === "%") v = v / 100;
      setPath(S, inp.getAttribute("data-s"), v);
    });
    document.querySelectorAll("#stForm textarea[data-tiers]").forEach(function (ta) { var t = parseTiers(ta.value); if (t) setPath(S, ta.getAttribute("data-tiers"), t); });
    saveSettings(); renderSettings(); mkHint(); toast("設定を保存しました");
    if (SP.items.length) runSpread(); if (EX.items.length) runExit();
  };
  $("stReset").onclick = function () { if (!confirm("手数料・しきい値を初期値に戻しますか？")) return; S = B.deepMerge(B.DEFAULT_SETTINGS, {}); saveSettings(); renderSettings(); mkHint(); toast("初期値に戻しました"); };
  $("stHealth").onclick = function () {
    var out = [], box = $("stHealthOut"); box.innerHTML = "<p class='hint'>チェック中…</p>";
    function line(ok, label, detail) { out.push("<li><span class='" + (ok ? "ok" : "ng") + "'>" + (ok ? "OK" : "NG") + "</span> " + esc(label) + (detail ? " <small>" + esc(detail) + "</small>" : "") + "</li>"); }
    line(true, "バージョン", V + " ／ engine " + B.VERSION);
    line(navigator.onLine !== false, "通信", navigator.onLine === false ? "オフライン" : "オンライン");
    var lsok = lsSet("btob_health", Date.now()); line(lsok, "設定の保存先（localStorage）", lsok ? "書込OK" : "書込不可（プライベートモード？）");
    var test = { mk: "__health__", recs: [{ price: 1 }], meta: {} };
    var p = (idb && !idbFailed) ? tx("readwrite", function (st) { st.put(test); }).then(function () { return tx("readonly", function (st) { return st.get("__health__"); }); }).then(function (got) { line(!!got && got.recs && got.recs[0].price === 1, "相場データの保存先（IndexedDB）", got ? "書込→読込 OK" : "読み戻し失敗"); return tx("readwrite", function (st) { st.delete("__health__"); }); }).catch(function (e) { line(false, "相場データの保存先（IndexedDB）", e.message); }) : Promise.resolve(line(false, "相場データの保存先（IndexedDB）", "使えないため localStorage に保存中（容量小）"));
    p.then(function () {
      var c = counts(); line(c.aucnet > 0, "オークネット相場", fmtN(c.aucnet) + "件"); line(true, "エコオク相場", fmtN(c.ecoauc) + "件" + (c.ecoauc ? "" : "（未取込）")); line(c.yba > 0, "YBA相場", fmtN(c.yba) + "件");
      return fetch(SEED_AUC + "?v=" + V, { method: "HEAD" }).then(function (r) { line(r.ok, "初期データファイル", r.ok ? "取得可" : "HTTP " + r.status); }).catch(function (e) { line(false, "初期データファイル", e.message); });
    }).then(function () {
      try { var r = B.evaluate({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 3 }, "ecoauc", 50000, "aucnet", DATA, S); line(!!r && !!r.judge, "判定エンジン", r.est.ok ? "CHANEL ショルダーバッグ → 相場" + B.yen(r.est.gross) + "／上限" + B.yen(r.maxBid) : "相場なし（データ未取込）"); } catch (e) { line(false, "判定エンジン", e.message); }
      line(true, "端末", (navigator.userAgent || "").slice(0, 90));
      box.innerHTML = "<ul class='steps' style='margin-top:10px'>" + out.join("") + "</ul>";
    });
  };

  /* ================= バグ報告 ================= */
  (function () {
    var U = "https://inrvprlyobghviklulcv.supabase.co/rest/v1/ailab_notes";
    var K = "sb_publishable_ZrCNcsRHMci-l7Fns8QtIA_X22XZGJp";
    var M = $("bugM");
    $("bugL").onclick = function () { M.classList.add("on"); };
    $("bugC").onclick = function () { M.classList.remove("on"); $("bugD").style.display = "none"; };
    $("bugS").onclick = function () {
      var t = $("bugT").value.trim(); if (!t) { $("bugT").focus(); return; }
      var btn = this; btn.disabled = true;
      function done() { $("bugD").style.display = "block"; $("bugT").value = ""; btn.disabled = false; setTimeout(function () { M.classList.remove("on"); $("bugD").style.display = "none"; }, 1800); }
      if (P.get("demo") === "1") { done(); return; }
      fetch(U, { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }, body: JSON.stringify({ member_id: "bug_btob-navi", member_name: "BtoB仕入れ判定ナビ", mood: "バグ報告", worry: t, want: location.href.slice(0, 180) + " ／ " + navigator.userAgent.slice(0, 140) }) })
        .then(function () { done(); }).catch(function () { btn.disabled = false; alert("送信できませんでした。通信環境をご確認ください。"); });
    };
  })();

  /* ================= 起動 ================= */
  function updateBadge() { var c = counts(); $("dataBadge").textContent = "相場：オークネット " + fmtN(c.aucnet) + "／エコオク " + fmtN(c.ecoauc) + "／YBA " + fmtN(c.yba) + (c.mercari ? "／メルカリ " + fmtN(c.mercari) : ""); }
  function boot() {
    var done = false;
    function finish() { if (done) return; done = true; var l = $("loader"); if (l) l.style.display = "none"; }
    setTimeout(finish, 9000); // 何があっても画面を出す
    try {
      $("verLabel").textContent = V;
      fillCats(); mkHint(); renderSettings();
      showView(lsGet("btob_tab", "spread"));
    } catch (e) { log("init ui error", e.message); showEsc(); }
    openDB().then(function (d) { idb = d; }).catch(function (e) { log("idb open fail", e.message); idbFailed = true; })
      .then(loadAll).catch(function (e) { log("loadAll fail", e.message); })
      .then(function () { updateBadge(); mkHint(); finish(); return loadSeeds(); })
      .catch(function (e) { log("seed fail", e.message); })
      .then(function () { updateBadge(); mkHint(); renderDataStats(); if (document.querySelector(".tab.on") && document.querySelector(".tab.on").getAttribute("data-v") === "data") renderDataStats(); })
      .catch(function (e) { log("boot tail", e.message); })
      .then(finish);
  }
  // テスト／デバッグ用フック
  window.__BTOB_STATE = { counts: counts, data: DATA, settings: function () { return S; }, spreadCSV: function () { return B.toCSV(spreadRows()); }, spreadTSV: spreadSheetTSV, results: function () { return SP.results; }, exit: function () { return EX.results; }, version: V };
  boot();
})();
