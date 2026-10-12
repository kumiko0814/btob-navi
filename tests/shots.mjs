// node tests/shots.mjs — ガイド用スクリーンショットを img/guide/ に生成（ローカルサーバ起動中に実行）
import { chromium } from "playwright-core";
import fs from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.URL || "http://127.0.0.1:8765/";
const OUT = process.env.OUT || "img/guide";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1.5, locale: "ja-JP" });
const page = await ctx.newPage();
page.on("dialog", d => d.dismiss());
async function shot(sel, file) { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 82 }); console.log("saved", file); }

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#loader", { state: "hidden", timeout: 20000 });
await page.waitForFunction(() => window.__BTOB_STATE && window.__BTOB_STATE.counts().aucnet > 3000, null, { timeout: 40000 });
// スクショ中はタブ帯を固定しない（カードの上に被らないように）
const UNSTICK = ".tabs{position:static !important} #bugL,#toast{display:none !important} .app{max-width:1360px !important}";
await page.setViewportSize({ width: 1400, height: 900 });
await page.addStyleTag({ content: UNSTICK });

// g0: ブックマークレットのカード
await page.click('.tab[data-v="data"]');
await page.waitForFunction(() => (document.querySelector("#dmBookmarklet").getAttribute("href") || "").startsWith("javascript:"), null, { timeout: 15000 });
await shot("#dmBookmarklet >> xpath=ancestor::div[contains(@class,'card')]", "g0-bookmarklet.jpg");

// g1: 受信プレビュー（架空の一覧を送る）
const href = await page.$eval("#dmBookmarklet", a => a.getAttribute("href"));
const code = decodeURIComponent(href.slice("javascript:".length));
const fx = await ctx.newPage(); fx.on("dialog", d => d.dismiss());
await fx.goto(URL + "tests/fixtures/fake-auction.html", { waitUntil: "domcontentloaded" });
const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }), fx.evaluate(code)]);
await popup.waitForLoadState("domcontentloaded");
await popup.waitForSelector("#dmToSpread", { timeout: 30000 });
await popup.setViewportSize({ width: 1000, height: 900 });
await popup.addStyleTag({ content: UNSTICK });
{ const el = await popup.$("#dmPreview .card"); await el.scrollIntoViewIfNeeded(); await popup.waitForTimeout(200); await el.screenshot({ path: `${OUT}/g1-recv.jpg`, type: "jpeg", quality: 82 }); console.log("saved g1-recv.jpg"); }
await popup.close(); await fx.close();

// g2/g3: 仕入れ判定の結果表とアクション
await page.click('.tab[data-v="spread"]');
await page.click("#spSample"); await page.click("#spRun");
await page.waitForSelector("#spTable tbody tr");
await page.waitForTimeout(300);
await shot("#spWrap", "g2-spread.jpg");
{ // サマリー＋アクション行をまとめて
  const a = await page.$("#spSummary"); const b = await page.$("#spActions");
  const ba = await a.boundingBox(); const bb = await b.boundingBox();
  await a.scrollIntoViewIfNeeded();
  const ba2 = await a.boundingBox(); const bb2 = await b.boundingBox();
  const clip = { x: Math.min(ba2.x, bb2.x) - 4, y: ba2.y - 4, width: Math.max(ba2.width, bb2.width) + 8, height: (bb2.y + bb2.height) - ba2.y + 8 };
  await page.screenshot({ path: `${OUT}/g3-actions.jpg`, type: "jpeg", quality: 82, clip });
  console.log("saved g3-actions.jpg", ba, bb);
}

// g4: 出口判定
await page.click('.tab[data-v="exit"]');
await page.click("#exSample"); await page.click("#exRun");
await page.waitForSelector("#exTable tbody tr");
await page.waitForTimeout(300);
await shot("#exWrap", "g4-exit.jpg");

await browser.close();
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(`${OUT}/${f}`).size);
