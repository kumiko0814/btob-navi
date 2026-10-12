// node tests/unit.mjs — engine の純ロジック検証
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const B = require("../js/engine.js");

let n = 0;
function t(name, fn) { try { fn(); n++; console.log("ok  ", name); } catch (e) { console.log("FAIL", name, "\n     ", e.message); process.exitCode = 1; } }

t("nfkc 全角→半角", () => assert.equal(B.nfkc("ＬＯＵＩＳ　ＶＵＩＴＴＯＮ"), "LOUIS VUITTON"));
t("canonBrand 全角", () => assert.equal(B.canonBrand("ＬＯＵＩＳ　ＶＵＩＴＴＯＮ"), "LOUIS VUITTON"));
t("canonBrand カナ", () => assert.equal(B.canonBrand("ルイヴィトン"), "LOUIS VUITTON"));
t("canonBrand Dior", () => assert.equal(B.canonBrand("Ｃｈｒｉｓｔｉａｎ　Ｄｉｏｒ"), "DIOR"));
t("canonBrand Ferragamo", () => assert.equal(B.canonBrand("Ｆｅｒｒａｇａｍｏ"), "SALVATORE FERRAGAMO"));
t("canonBrand jewelry no brand", () => assert.equal(B.canonBrand("ｊｅｗｅｌｒｙ（Ｎｏ　Ｂｒａｎｄ）"), "NO BRAND"));
t("brandFromText 商品名", () => assert.equal(B.brandFromText("ルイヴィトン　ジッピーウォレット　モノグラム　長財布　M81279　ピンク"), "LOUIS VUITTON"));
t("brandFromText 英字", () => assert.equal(B.brandFromText("HERMES エルメス 黄金の拍車 カレ90"), "HERMES"));
t("brandFromText 誤検知なし(SILVER→LV)", () => assert.equal(B.brandFromText("SILVER RING 925"), ""));
t("brandFromText ウンガロ", () => assert.equal(B.brandFromText("ウンガロ 財布"), "UNGARO"));
t("catOf 長財布", () => assert.equal(B.catOf("ジッピーウォレット 長財布"), "長財布"));
t("catOf ダウンジャケット > ジャケット", () => assert.equal(B.catOf("ダウンジャケット"), "ダウン"));
t("catOf タイピン(タイではない)", () => assert.equal(B.catOf("タイピン"), "アクセサリーその他"));
t("catOf ネクタイ", () => assert.equal(B.catOf("ネクタイ ５本"), "ネクタイ"));
t("resolveCat 形状優先", () => assert.equal(B.resolveCat("ショルダーバッグ", "ウンガロ 財布", "バッグ"), "ショルダーバッグ"));
t("resolveCat ジャンルfallback", () => assert.equal(B.resolveCat("", "鏡", "ジュエリー"), "服飾小物その他"));
t("rankScore 基本", () => { assert.equal(B.rankScore("A"), 4); assert.equal(B.rankScore("AB"), 3.5); assert.equal(B.rankScore("C"), 2); assert.equal(B.rankScore("N"), 6); });
t("rankScore メルカリ表記", () => { assert.equal(B.rankScore("2.未使用に近い"), 5); assert.equal(B.rankScore("3.目立った傷汚れなし"), 4); assert.equal(B.rankScore("5.傷汚れあり"), 2); });
t("rankScore プラス", () => assert.equal(B.rankScore("B+"), 3.25));
t("rankLabel", () => { assert.equal(B.rankLabel(3), "B"); assert.equal(B.rankLabel(3.4), "AB"); });
t("modelOf LV", () => assert.equal(B.modelOf("ルイヴィトン ジッピーウォレット M81279 ピンク"), "M81279"));
t("modelOf 受付番号は拾わない", () => assert.equal(B.modelOf("844-38615 バッグ"), ""));
t("num 1番手6000円", () => assert.equal(B.num("1番手6000円"), 6000));
t("parseRange 6-7000円", () => assert.equal(B.parseRange("6-7000円"), 6500));
t("parseRange 10000-12000", () => assert.equal(B.parseRange("10000-12000"), 11000));
t("parseDelimited TSV", () => { const r = B.parseDelimited("a\tb\tc\n1\t2\t3\n"); assert.equal(r.delim, "\t"); assert.equal(r.rows.length, 2); });
t("parseDelimited CSV quoted", () => { const r = B.parseDelimited('名前,価格\n"ウンガロ, 財布","1,875"\n'); assert.equal(r.rows[1][0], "ウンガロ, 財布"); assert.equal(B.num(r.rows[1][1]), 1875); });

const aucHeader = ["受付番号", "ジャンル", "メーカー", "ライン/タイプ", "形状", "型番", "商品名", "割合", "落札料含価格", "オークネット上\n成約価格", "卸価格（税抜）\n＝買取金額", "発注数", "合計額", "固有No（シリアルNo)", "評価", "外装評価", "内装評価"];
t("autoMap オークネットCSV（改行入りヘッダー）", () => {
  const m = B.autoMap(aucHeader);
  assert.equal(m.id, 0); assert.equal(m.genre, 1); assert.equal(m.brand, 2); assert.equal(m.shape, 4); assert.equal(m.model, 5); assert.equal(m.name, 6);
  assert.equal(m.rank, 14); assert.equal(m.ext, 15); assert.equal(m.inn, 16);
  assert.equal(m.price, 9, "成約価格が最優先");
});
t("autoMap 卸価格のみの時は卸価格", () => { const m = B.autoMap(["メーカー", "商品名", "卸価格（税抜）", "評価"]); assert.equal(m.price, 2); });
t("autoMap 入札シート", () => { const m = B.autoMap(["写真", "受付番号", "カテゴリー", "ブランド名", "スタート価格", "入札価格", "メルカリ相場", "リンク", "用途", "入札日", "落札結果", "落札価格", "備考"]); assert.equal(m.brand, 3); assert.equal(m.shape, 2); assert.equal(m.start, 4); assert.equal(m.price, 11); assert.equal(m.est, 6); assert.equal(m.result, 10); assert.equal(m.url, 7); });
t("autoMap 在庫管理表", () => { const m = B.autoMap(["番号", "商品名", "売れたら✔︎", "１軍/2軍", "状態", "仕入先", "仕入単価", "予想売価", "販売価格"]); assert.equal(m.name, 1); assert.equal(m.rank, 4); assert.equal(m.cost, 6); assert.equal(m.est, 7); assert.equal(m.id, 0); });
t("detectHeader", () => { assert.equal(B.detectHeader([aucHeader, ["844-1", "バッグ", "ＣＨＡＮＥＬ"]]), 0); assert.equal(B.detectHeader([["844-38615", "ＣＨＡＮＥＬ", "ショルダーバッグ", "B", "¥38,000"]]), -1); });
t("guessMap ヘッダー無し", () => {
  const rows = [["844-38615", "ＣＨＡＮＥＬ", "ショルダーバッグ", "B", "¥38,000"], ["844-38616", "ＨＥＲＭＥＳ", "スカーフ", "A", "¥18,000"], ["844-38617", "ＧＵＣＣＩ", "長財布", "C", "¥9,000"]];
  const m = B.guessMap(rows); assert.equal(m.id, 0); assert.equal(m.brand, 1); assert.equal(m.shape, 2); assert.equal(m.rank, 3); assert.equal(m.price, 4);
});
t("toRecords 不成立除外・卸価格換算", () => {
  const rows = [["1", "ＣＨＡＮＥＬ", "ショルダーバッグ", "", "マトラッセ", "B", "成約", "110000"], ["2", "ＣＨＡＮＥＬ", "ショルダーバッグ", "", "マトラッセ", "B", "流れ", "90000"]];
  const map = { id: 0, brand: 1, shape: 2, model: 3, name: 4, rank: 5, result: 6, price: 7 };
  const r = B.toRecords(rows, map, "aucnet", { priceDivisor: 1.1 });
  assert.equal(r.recs.length, 1); assert.equal(r.skipped, 1); assert.equal(r.recs[0].price, 100000); assert.equal(r.recs[0].rank, 3); assert.equal(r.recs[0].cat, "ショルダーバッグ");
});

const S = B.deepMerge(B.DEFAULT_SETTINGS, {});
t("エコオク 買い手数料 段階", () => { assert.equal(B.buyerFee("ecoauc", 8000, S), 500); assert.equal(B.buyerFee("ecoauc", 30000, S), 1000); assert.equal(B.buyerFee("ecoauc", 60000, S), 2000); });
t("オークネット 落札料 4%・最低500", () => { assert.equal(B.buyerFee("aucnet", 33000, S), 1320); assert.equal(B.buyerFee("aucnet", 1000, S), 500); });
t("オークネット 成約料 3%", () => assert.equal(B.sellerFee("aucnet", 100000, S), 3000));
t("landed / net", () => { assert.equal(B.landed("ecoauc", 30000, S), 30000 + 1000 + 1000); assert.equal(B.net("aucnet", 50000, "バッグ", S), 50000 - 1500 - 1000); });
t("maxBid は目標ROIを満たす", () => {
  const gross = 60000, h = B.maxBid(gross, "aucnet", "ecoauc", "バッグ", S);
  assert.ok(h > 0);
  const roi = (B.net("aucnet", gross, "バッグ", S) - B.landed("ecoauc", h, S)) / B.landed("ecoauc", h, S);
  assert.ok(roi >= 0.30 && roi < 0.34, "roi=" + roi);
});
t("judge", () => { assert.equal(B.judge(10000, 0.4, S).mark, "◎"); assert.equal(B.judge(3500, 0.2, S).mark, "○"); assert.equal(B.judge(500, 0.05, S).mark, "△"); assert.equal(B.judge(-100, -0.01, S).mark, "×"); });

// 相場マッチングと評価
const recs = [];
for (let i = 0; i < 12; i++) recs.push({ mk: "aucnet", id: "x" + i, brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: i < 3 ? "A01112" : "", name: "マトラッセ", rank: i % 2 ? 3 : 4, price: 90000 + i * 5000, date: "" });
const data = { aucnet: recs };
t("estimateSell 型番一致", () => { const e = B.estimateSell({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "A01112", rank: 3 }, "aucnet", recs, S); assert.equal(e.level, 1); assert.equal(e.n, 3); });
t("estimateSell ブランド×品目×ランク（オークネット補正+1：B→共通4）", () => { const e = B.estimateSell({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 4 }, "aucnet", recs, S); assert.equal(e.level, 2); assert.ok(e.gross > 0); });
t("estimateSell 収録なし", () => { const e = B.estimateSell({ brand: "GUCCI", cat: "長財布", grp: "財布・小物", model: "", rank: 3 }, "aucnet", recs, S); assert.equal(e.ok, false); });
t("evaluate 入札額あり", () => {
  const r = B.evaluate({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 3, start: 50000 }, "ecoauc", 70000, "aucnet", data, S);
  assert.ok(r.est.ok); assert.ok(r.maxBid > 0); assert.equal(r.bid, 70000); assert.ok(r.profit != null); assert.ok(["◎", "○", "△", "×"].includes(r.judge.mark));
});
t("evaluate 入札額なし→上限表示", () => { const r = B.evaluate({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 3 }, "ecoauc", null, "aucnet", data, S); assert.equal(r.judge.mark, "入"); });
t("exitCompare 実データ", () => { const r = B.exitCompare({ brand: "CHANEL", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 3, cost: 54000, est: 150000 }, data, S); assert.ok(r.auc.ok); assert.ok(r.aucProfit != null); assert.ok(r.merProfit != null); assert.ok(r.advice.text); });
t("exitCompare 推定（係数）", () => { const r = B.exitCompare({ brand: "COACH", cat: "ショルダーバッグ", grp: "バッグ", model: "", rank: 4, cost: 4000, est: 10000 }, data, S); assert.equal(r.auc.level, 9); assert.equal(r.auc.gross, 4500); });
t("YBA 集計レコード", () => {
  const yrecs = [{ mk: "yba", id: "", brand: "BURBERRY", cat: "コート", grp: "アパレル", model: "", name: "コート", rank: 3, price: 15840, agg: { min: 1000, max: 41000, n: 48 }, date: "" }];
  const e = B.estimateSell({ brand: "BURBERRY", cat: "コート", grp: "アパレル", model: "", rank: 4 }, "yba", yrecs, S);
  assert.ok(e.ok); assert.equal(e.n, 48); assert.ok(e.gross > 15840 && e.gross <= 41000);
});
t("CSV/TSV", () => { assert.ok(B.toCSV([["a", "b,c"]]).indexOf('"b,c"') > 0); assert.equal(B.toTSV([["a", "b\tc"]]), "a\tb c"); });

// 集計レコード（初期データ形式）
const aggs = [
  { mk: "aucnet", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", rank: null, name: "cat", price: 12000, agg: { kind: "cat", n: 40, med: 12000, q1: 9000, q3: 16000, min: 4000, max: 30000, rankMed: 2.5 } },
  { mk: "aucnet", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", rank: 2, name: "catrank C", price: 10000, agg: { kind: "catrank", n: 25, med: 10000, q1: 8000, q3: 13000, min: 4000, max: 20000, rankMed: 2 } },
  { mk: "aucnet", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", rank: 3, name: "catrank B", price: 15000, agg: { kind: "catrank", n: 15, med: 15000, q1: 12000, q3: 19000, min: 8000, max: 30000, rankMed: 3 } },
  { mk: "aucnet", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "456116", rank: null, name: "model", price: 14000, agg: { kind: "model", n: 4, med: 14000, q1: 13000, q3: 15000, min: 12000, max: 16000, rankMed: 2.5 } },
  { mk: "aucnet", brand: "GUCCI", cat: "", grp: "財布・小物", model: "", rank: null, name: "grp", price: 9000, agg: { kind: "grp", n: 90, med: 9000, q1: 6000, q3: 14000, min: 2000, max: 30000, rankMed: 2.5 } }
];
t("集計：型番一致", () => { const e = B.estimateSell({ brand: "GUCCI", cat: "長財布", grp: "財布・小物", model: "456116", rank: 3 }, "aucnet", aggs, S); assert.equal(e.level, 1); assert.equal(e.gross, 14000); assert.equal(e.n, 4); });
t("集計：品目×ランク（オークネットB＝共通4）", () => { const e = B.estimateSell({ brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", rank: 4 }, "aucnet", aggs, S); assert.equal(e.level, 2); assert.equal(e.gross, 15000); });
t("集計：財布類まとめ＋ランク補正", () => { const e = B.estimateSell({ brand: "GUCCI", cat: "長財布", grp: "財布・小物", model: "", rank: 5 }, "aucnet", aggs, S); assert.equal(e.level, 3); assert.ok(/財布類/.test(e.label)); assert.ok(e.gross > 12000 && e.gross <= 30000, "gross=" + e.gross); });
t("集計：大分類フォールバック", () => { const e = B.estimateSell({ brand: "GUCCI", cat: "小物ケース", grp: "財布・小物", model: "", rank: null }, "aucnet", aggs, S); assert.equal(e.level, 4); assert.equal(e.gross, 9000); });
t("個別データ優先・集計が精密なら集計", () => {
  const mixed = aggs.concat([{ mk: "aucnet", id: "a", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", name: "x", rank: 3, price: 20000 }, { mk: "aucnet", id: "b", brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", name: "y", rank: 3, price: 22000 }]);
  const e = B.estimateSell({ brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "456116", rank: 4 }, "aucnet", mixed, S); assert.equal(e.level, 1, "型番集計が勝つ");
  const e2 = B.estimateSell({ brand: "GUCCI", cat: "財布", grp: "財布・小物", model: "", rank: null }, "aucnet", mixed, S); assert.equal(e2.level, 3); assert.equal(e2.n, 2, "個別2件(レベル3)が集計(レベル3)に優先");
});

console.log(`\n${n} tests passed${process.exitCode ? " (with failures)" : ""}`);
