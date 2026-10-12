// node tests/e2e.mjs  — 実ブラウザ（システムのChrome）でゴールデンパスを検証
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.URL || "http://127.0.0.1:8765/";
const OUT = process.env.OUT || "/tmp";
let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log("ok  ", name); } else { fail++; console.log("FAIL", name, extra == null ? "" : JSON.stringify(extra).slice(0, 300)); } }

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function fresh(viewport) {
  const ctx = await browser.newContext({ viewport, locale: "ja-JP" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") { const u = (m.location() && m.location().url) || ""; if (!/favicon/.test(m.text() + u)) errors.push("console: " + m.text() + " @ " + u); } });
  return { ctx, page, errors };
}

// ---------- デスクトップ：ゴールデンパス ----------
{
  const { ctx, page, errors } = await fresh({ width: 1200, height: 900 });
  await page.goto(URL + "?debug=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loader", { state: "hidden", timeout: 20000 });
  ok(true, "ローダーが消える");
  await page.waitForFunction(() => window.__BTOB_STATE && window.__BTOB_STATE.counts().aucnet > 4000 && window.__BTOB_STATE.counts().yba > 90, null, { timeout: 40000 });
  const c = await page.evaluate(() => window.__BTOB_STATE.counts());
  ok(c.aucnet >= 3900 && c.aucnet <= 4278, "初期データ：オークネット 約3,9xx点の集計", c);
  ok(c.yba >= 500, "初期データ：YBA 集計（元データ500件以上）", c);
  const badge = await page.textContent("#dataBadge");
  ok(/オークネット [34],\d{3}/.test(badge), "ヘッダーバッジに件数", badge);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bodyBg !== "rgb(0, 0, 0)", "背景が黒ではない", bodyBg);

  // 仕入れ判定：サンプル→判定
  await page.click("#spSample");
  await page.click("#spRun");
  await page.waitForSelector("#spTable tbody tr");
  const rows = await page.$$eval("#spTable tbody tr", r => r.length);
  ok(rows === 6, "判定表 6行", rows);
  const marks = await page.$$eval("#spTable tbody .j", els => els.map(e => e.textContent));
  ok(marks.every(m => ["◎", "○", "△", "×", "入", "—"].includes(m)), "判定マークが出る", marks);
  const res = await page.evaluate(() => window.__BTOB_STATE.results().map(r => ({ b: r.item.brand, cat: r.item.cat, ok: r.est.ok, lvl: r.est.level, gross: r.est.gross, maxBid: r.maxBid, profit: r.profit, j: r.judge.mark })));
  ok(res.filter(r => r.ok).length >= 4, "4点以上で相場が出る（CHANEL/LV/HERMES/GUCCI/DIOR）", res);
  const chanel = res.find(r => r.b === "CHANEL");
  ok(chanel && chanel.ok && chanel.cat === "ショルダーバッグ" && chanel.gross > 30000, "CHANEL ショルダーバッグ：相場あり", chanel);
  const lv = res.find(r => r.b === "LOUIS VUITTON");
  ok(lv && lv.cat === "長財布", "LV ジッピーウォレット→長財布", lv);
  const aniary = res.find(r => r.b === "ANIARY");
  ok(aniary && !aniary.ok && aniary.j === "—", "ANIARY：相場なしは数字を出さない", aniary);
  ok(lv && lv.ok && /財布/.test(lv.cat), "LV 長財布：財布類まとめで相場が出る", lv);
  ok(res.filter(r => r.ok).every(r => typeof r.maxBid === "number" && r.profit != null), "相場ありの行は上限入札額と粗利が出る（スタート価格で仮判定）", res);
  const summary = await page.textContent("#spSummary");
  ok(/判定した点数/.test(summary) && /相場なし/.test(summary), "サマリータイル", summary.slice(0, 120));

  // 入札額の打ち直しで粗利が変わる
  const before = await page.evaluate(() => window.__BTOB_STATE.results().find(r => r.item.brand === "CHANEL").profit);
  const chanelRow = await page.$("#spTable tbody tr:has-text('CHANEL') input.bid");
  await chanelRow.fill("150000"); await chanelRow.dispatchEvent("change");
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__BTOB_STATE.results().find(r => r.item.brand === "CHANEL"));
  ok(after.bid === 150000 && after.profit !== before, "入札額を変えると粗利が再計算", { before, after: after.profit });

  // CSV / 入札シートTSV
  const csv = await page.evaluate(() => window.__BTOB_STATE.spreadCSV());
  ok(csv.startsWith("﻿受付番号,ブランド") && csv.split("\r\n").length === 7, "CSV書き出し（ヘッダー＋6行）", csv.slice(0, 80));
  const tsv = await page.evaluate(() => window.__BTOB_STATE.spreadTSV());
  const tsvRows = tsv.split("\n");
  ok(tsvRows[0].split("\t").length === 13 && tsvRows.length === 7 && tsvRows.every(l => l.split("\t").length === 13), "入札シート形式TSV（13列×7行）", tsvRows[1]);

  // 並び順
  await page.selectOption("#spSort", "profit");
  const firstAfterSort = await page.$eval("#spTable tbody tr:first-child .ttl", e => e.textContent);
  ok(!!firstAfterSort, "並び替え動作", firstAfterSort);

  // 単品判定
  await page.fill("#sgBrand", "エルメス カレ90 スカーフ");
  await page.selectOption("#sgRank", "A");
  await page.fill("#sgPrice", "12000");
  await page.click("#sgRun");
  const sg = await page.textContent("#sgOut");
  ok(/HERMES/.test(sg) && /¥/.test(sg) && /スカーフ/.test(sg), "単品判定：HERMES スカーフ", sg.slice(0, 160));

  // 出口判定
  await page.click('.tab[data-v="exit"]');
  await page.click("#exSample"); await page.click("#exRun");
  await page.waitForSelector("#exTable tbody tr");
  const exRows = await page.$$eval("#exTable tbody tr", r => r.length);
  ok(exRows === 5, "出口判定 5行", exRows);
  const ex = await page.evaluate(() => window.__BTOB_STATE.exit().map(r => ({ b: r.item.brand, cat: r.item.cat, rank: r.item.rank, cost: r.item.cost, est: r.item.est, auc: r.auc && r.auc.ok ? r.auc.level : null, aucNet: r.aucNet, merNet: r.merNet, adv: r.advice.cls })));
  ok(ex.every(r => r.cost != null && r.est != null), "在庫管理表の仕入単価・予想売価を読めた", ex);
  ok(ex.every(r => r.merNet != null), "メルカリ手残りが全行で出る", ex);
  ok(ex.filter(r => r.auc != null).length >= 4, "業者オク想定が4行以上（実データ or 推定）", ex);
  const ksEx = ex.find(r => r.b === "KATE SPADE");
  ok(ksEx && ksEx.auc === 9 && ksEx.aucNet != null, "KATE SPADE は推定（メルカリ相場×係数）にフォールバック", ksEx);
  ok(ex.every(r => ["best", "good", "bad", "na", "info"].includes(r.adv)), "おすすめが出る", ex.map(r => r.adv));
  const exSum = await page.textContent("#exSummary");
  ok(/仕入総額/.test(exSum), "出口サマリー", exSum.slice(0, 100));

  // データタブ
  await page.click('.tab[data-v="data"]');
  const stats = await page.textContent("#dmStats");
  ok(/[34],\d{3}/.test(stats) && /初期/.test(stats), "データタブに初期データの件数と「初期」ラベル", stats.slice(0, 200));
  // 貼り付け取り込み（エコオク）
  await page.fill("#dmText", "ブランド名\t商品名\tランク\t型番\t落札価格\nシャネル\tマトラッセ チェーンショルダー\tA\tA01112\t180000\nシャネル\tマトラッセ チェーンショルダー\tB\tA01112\t150000\nルイヴィトン\tネヴァーフルMM モノグラム\tB\tM40156\t95000\nシャネル\tカンボンライン 長財布\tC\t\t30000");
  await page.click("#dmParse");
  await page.waitForSelector("#dmImport");
  const testTxt = await page.textContent("#dmTest");
  ok(/4行が有効/.test(testTxt), "貼り付けプレビュー：4行有効", testTxt);
  await page.click("#dmImport");
  await page.waitForFunction(() => window.__BTOB_STATE.counts().ecoauc === 4, null, { timeout: 8000 });
  ok(true, "エコオクに4件取り込み");
  // 重複は除外される
  await page.fill("#dmText", "ブランド名\t商品名\tランク\t型番\t落札価格\nシャネル\tマトラッセ チェーンショルダー\tA\tA01112\t180000");
  await page.click("#dmParse"); await page.waitForSelector("#dmImport"); await page.click("#dmImport");
  await page.waitForTimeout(500);
  ok((await page.evaluate(() => window.__BTOB_STATE.counts().ecoauc)) === 4, "重複行は追加されない");

  // 市場の向きを逆（オークネット→エコオク）にして判定できる
  await page.click('.tab[data-v="spread"]');
  await page.selectOption("#buyMk", "aucnet"); await page.selectOption("#sellMk", "ecoauc");
  await page.fill("#spList", "ブランド\t商品名\tランク\t型番\tスタート価格\nCHANEL\tマトラッセ チェーンショルダー\tB\tA01112\t100000");
  await page.click("#spRun");
  await page.waitForSelector("#spTable tbody tr");
  const rev = await page.evaluate(() => window.__BTOB_STATE.results()[0]);
  ok(rev.est.ok && rev.est.level === 1 && rev.sellMk === "ecoauc", "逆方向：エコオク取込データで型番一致", { ok: rev.est.ok, lvl: rev.est.level, gross: rev.est.gross });

  // 設定：目標ROIを変えると上限入札額が下がる
  await page.selectOption("#buyMk", "ecoauc"); await page.selectOption("#sellMk", "aucnet");
  await page.fill("#spList", "ブランド\t商品名\tランク\tスタート価格\nCHANEL\tマトラッセ チェーンショルダーバッグ\tB\t80000");
  await page.click("#spRun"); await page.waitForSelector("#spTable tbody tr");
  const mb1 = await page.evaluate(() => window.__BTOB_STATE.results()[0].maxBid);
  await page.click('.tab[data-v="settings"]');
  await page.fill("#stForm input[data-s='targetRoi']", "60");
  await page.click("#stSave");
  await page.waitForTimeout(300);
  const mb2 = await page.evaluate(() => window.__BTOB_STATE.results()[0].maxBid);
  ok(mb2 < mb1 && mb2 > 0, "目標ROI 30→60% で上限入札額が下がる", { mb1, mb2 });
  await page.fill("#stForm input[data-s='targetRoi']", "30"); await page.click("#stSave");

  // 動作チェック
  await page.click("#stHealth");
  await page.waitForFunction(() => /判定エンジン/.test(document.querySelector("#stHealthOut").textContent), null, { timeout: 15000 });
  const health = await page.textContent("#stHealthOut");
  ok(/書込→読込 OK/.test(health), "🩺 IndexedDB 書込→読込", health.slice(0, 300));
  ok(!/NG/.test(health), "🩺 NG項目なし", health);

  // バグ報告モーダル
  await page.click("#bugL");
  ok(await page.isVisible("#bugM .bx"), "不具合報告モーダルが開く");
  await page.click("#bugC");

  // 再読込で保持（IndexedDB）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loader", { state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => window.__BTOB_STATE && window.__BTOB_STATE.counts().aucnet > 4000, null, { timeout: 20000 });
  const c2 = await page.evaluate(() => window.__BTOB_STATE.counts());
  ok(c2.aucnet === c.aucnet && c2.ecoauc === 4 && c2.yba === c.yba, "再読込後もデータ保持（取込分含む）", c2);
  const roiKept = await page.evaluate(() => window.__BTOB_STATE.settings().targetRoi);
  ok(Math.abs(roiKept - 0.30) < 1e-9, "設定が保持される", roiKept);
  ok((await page.$eval("#dbg", e => e.textContent)).indexOf("ERROR") < 0, "画面内ログにERRORなし", await page.$eval("#dbg", e => e.textContent.slice(0, 300)));

  await page.screenshot({ path: OUT + "/btob_desktop_spread.png", fullPage: false });
  await page.click('.tab[data-v="spread"]'); await page.click("#spSample"); await page.click("#spRun"); await page.waitForSelector("#spTable tbody tr");
  await page.screenshot({ path: OUT + "/btob_desktop_result.png", fullPage: true });
  ok(errors.length === 0, "コンソール/ページエラーなし（デスクトップ）", errors);
  await ctx.close();
}

// ---------- モバイル（iPhone幅） ----------
{
  const { ctx, page, errors } = await fresh({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#loader", { state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => window.__BTOB_STATE && window.__BTOB_STATE.counts().aucnet > 4000, null, { timeout: 40000 });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 391, "横スクロールなし（390px）", sw);
  await page.click("#spSample"); await page.click("#spRun"); await page.waitForSelector("#spTable tbody tr");
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw2 <= 391, "結果表示後も横オーバーフローなし（表は内側スクロール）", sw2);
  await page.screenshot({ path: OUT + "/btob_mobile.png", fullPage: true });
  await page.click('.tab[data-v="exit"]'); await page.click("#exSample"); await page.click("#exRun"); await page.waitForSelector("#exTable tbody tr");
  await page.screenshot({ path: OUT + "/btob_mobile_exit.png", fullPage: true });
  ok(errors.length === 0, "コンソール/ページエラーなし（モバイル）", errors);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
