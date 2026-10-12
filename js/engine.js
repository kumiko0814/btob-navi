/* ==========================================================================
   BtoB 仕入れ判定ナビ — engine.js（純ロジック・DOM非依存）
   取り込み（CSV/TSV/貼り付け）→ 正規化（ブランド/品目/ランク/型番）→
   相場マッチング → 手数料 → 粗利/ROI/上限入札額 → 判定
   ========================================================================== */
var BTOB = (function () {
  "use strict";
  var VERSION = "20261013a";

  /* ---------------- 文字列ユーティリティ ---------------- */
  function nfkc(s) {
    if (s == null) return "";
    s = "" + s;
    try { s = s.normalize("NFKC"); } catch (e) { /* 古い環境 */ }
    return s.replace(/[\u3000\s]+/g, " ").trim();
  }
  function up(s) { return nfkc(s).toUpperCase(); }
  // 比較用キー：大文字化＋空白/記号を除去
  function key(s) { return up(s).replace(/[\s\-_・\.,'’&/()（）\[\]【】「」:：]/g, ""); }
  function esc(s) {
    return ("" + (s == null ? "" : s)).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // "¥12,000" "12000円" "1番手6000円" → 数値
  function num(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = nfkc(v).replace(/\d+番手/g, "").replace(/[,，¥￥円\s]/g, "");
    var m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }
  // "10000-12000" / "6-7000円" / "¥12,000" → 代表値（レンジは中央）
  function parseRange(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = nfkc(v).replace(/[,，¥￥円\s]/g, "");
    var m = s.match(/(\d+)\s*[-〜~～]\s*(\d+)/);
    if (m) {
      var a = m[1], b = m[2];
      if (a.length < b.length) a = a + b.slice(a.length); // "6-7000" → 6000-7000
      var x = parseInt(a, 10), y = parseInt(b, 10);
      return Math.round((x + y) / 2);
    }
    return num(s);
  }
  function yen(n) {
    if (n == null || !isFinite(n)) return "—";
    var neg = n < 0; n = Math.abs(Math.round(n));
    return (neg ? "−" : "") + "¥" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function pct(n) { if (n == null || !isFinite(n)) return "—"; return Math.round(n * 100) + "%"; }
  function median(arr) {
    var a = arr.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* ---------------- ブランド辞書 ---------------- */
  // 正規名 → 別表記（カナ・全角・略称）。正規名自身も辞書に入る
  var BRANDS = {
    "LOUIS VUITTON": ["ルイヴィトン", "ルイ・ヴィトン", "ヴィトン", "ビトン", "LOUISVUITTON", "LV"],
    "CHANEL": ["シャネル"],
    "HERMES": ["エルメス", "HERMÈS"],
    "GUCCI": ["グッチ"],
    "DIOR": ["ディオール", "クリスチャンディオール", "クリスチャン・ディオール", "CHRISTIAN DIOR"],
    "PRADA": ["プラダ"],
    "CELINE": ["セリーヌ"],
    "FENDI": ["フェンディ"],
    "BURBERRY": ["バーバリー", "バーバリーズ", "BURBERRYS", "バーバリーブルーレーベル", "BURBERRY BLUE LABEL", "BLUE LABEL CRESTBRIDGE", "BLACK LABEL CRESTBRIDGE", "バーバリーブラックレーベル"],
    "BOTTEGA VENETA": ["ボッテガヴェネタ", "ボッテガ・ヴェネタ", "ボッテガ"],
    "SAINT LAURENT": ["サンローラン", "イヴサンローラン", "イヴ・サンローラン", "YVES SAINT LAURENT", "YSL"],
    "LOEWE": ["ロエベ"],
    "GIVENCHY": ["ジバンシー", "ジバンシィ"],
    "SALVATORE FERRAGAMO": ["フェラガモ", "サルヴァトーレフェラガモ", "サルバトーレフェラガモ", "FERRAGAMO"],
    "VALENTINO": ["ヴァレンティノ", "バレンチノ", "ヴァレンチノ", "バレンティノ", "VALENTINO GARAVANI", "RED VALENTINO", "レッドヴァレンティノ", "レッドバレンチノ"],
    "CARTIER": ["カルティエ"],
    "BVLGARI": ["ブルガリ", "BULGARI"],
    "TIFFANY": ["ティファニー", "TIFFANY&CO", "TIFFANY & CO."],
    "OMEGA": ["オメガ"],
    "ROLEX": ["ロレックス"],
    "SEIKO": ["セイコー", "グランドセイコー", "GRAND SEIKO"],
    "MIU MIU": ["ミュウミュウ", "MIUMIU"],
    "BALENCIAGA": ["バレンシアガ"],
    "CHLOE": ["クロエ", "CHLOÉ", "SEE BY CHLOE", "シーバイクロエ"],
    "DUNHILL": ["ダンヒル"],
    "COACH": ["コーチ", "オールドコーチ"],
    "KATE SPADE": ["ケイトスペード", "KATESPADE"],
    "JIMMY CHOO": ["ジミーチュウ"],
    "FURLA": ["フルラ"],
    "TORY BURCH": ["トリーバーチ"],
    "MICHAEL KORS": ["マイケルコース"],
    "VIVIENNE WESTWOOD": ["ヴィヴィアンウエストウッド", "ヴィヴィアン・ウエストウッド", "ヴィヴィアン", "ビビアン"],
    "BACCARAT": ["バカラ"],
    "UGG": ["アグ"],
    "ANIARY": ["アニアリ", "アニアリー"],
    "ANTEPRIMA": ["アンテプリマ"],
    "COLE HAAN": ["コールハーン"],
    "HUNTING WORLD": ["ハンティングワールド"],
    "ETRO": ["エトロ", "ETORO"],
    "SWAROVSKI": ["スワロフスキー"],
    "RAY-BAN": ["レイバン", "RAYBAN"],
    "GOYARD": ["ゴヤール"],
    "MONCLER": ["モンクレール"],
    "MAX MARA": ["マックスマーラ", "MAXMARA"],
    "ISSEY MIYAKE": ["イッセイミヤケ", "PLEATS PLEASE", "プリーツプリーズ"],
    "LORO PIANA": ["ロロピアーナ"],
    "HERNO": ["ヘルノ"],
    "DOLCE&GABBANA": ["ドルガバ", "ドルチェ&ガッバーナ", "ドルチェアンドガッバーナ", "D&G", "DOLCE & GABBANA", "DOLCE AND GABBANA"],
    "CANADA GOOSE": ["カナダグース"],
    "THE NORTH FACE": ["ノースフェイス", "ザノースフェイス", "NORTH FACE"],
    "SUPREME": ["シュプリーム"],
    "VERSACE": ["ヴェルサーチ", "ベルサーチ", "ヴェルサーチェ"],
    "COMME DES GARCONS": ["コムデギャルソン", "コム・デ・ギャルソン"],
    "DSQUARED2": ["ディースクエアード"],
    "MAISON MARGIELA": ["マルジェラ", "メゾンマルジェラ", "MARTIN MARGIELA", "マルタンマルジェラ"],
    "CHROME HEARTS": ["クロムハーツ"],
    "TATRAS": ["タトラス"],
    "CHRISTIAN LOUBOUTIN": ["ルブタン", "クリスチャンルブタン", "LOUBOUTIN"],
    "STELLA MCCARTNEY": ["ステラマッカートニー"],
    "SACAI": ["サカイ"],
    "YOKO CHAN": ["ヨーコチャン"],
    "FOXEY": ["フォクシー", "FOXEY NEWYORK"],
    "OFF-WHITE": ["オフホワイト", "OFFWHITE"],
    "NIKE": ["ナイキ"],
    "ADIDAS": ["アディダス"],
    "NEW BALANCE": ["ニューバランス"],
    "RALPH LAUREN": ["ラルフローレン", "ポロラルフローレン", "POLO RALPH LAUREN"],
    "PAUL SMITH": ["ポールスミス"],
    "KENZO": ["ケンゾー"],
    "LANVIN": ["ランバン"],
    "LONGCHAMP": ["ロンシャン"],
    "SAMANTHA THAVASA": ["サマンサタバサ"],
    "ANNA SUI": ["アナスイ"],
    "UNGARO": ["ウンガロ"],
    "MARNI": ["マルニ"],
    "REPETTO": ["レペット"],
    "LEONARD": ["レオナール"],
    "GRACE CONTINENTAL": ["グレースコンチネンタル"],
    "AGNES B": ["アニエスベー", "AGNÈS B."],
    "TUMI": ["トゥミ"],
    "PORTER": ["ポーター"],
    "KITAMURA": ["キタムラ"],
    "MARC JACOBS": ["マークジェイコブス", "MARC BY MARC JACOBS"],
    "A.P.C.": ["アーペーセー", "APC"],
    "TASAKI": ["タサキ"],
    "MIKIMOTO": ["ミキモト"],
    "4℃": ["ヨンドシー", "カナル4℃", "カナル4C", "CANAL4℃"],
    "AGETE": ["アガット"],
    "STAR JEWELRY": ["スタージュエリー"],
    "VENDOME AOYAMA": ["ヴァンドーム青山"],
    "CASIO": ["カシオ", "G-SHOCK", "Gショック"],
    "CITIZEN": ["シチズン"],
    "TAG HEUER": ["タグホイヤー"],
    "HAMILTON": ["ハミルトン"],
    "JINS": ["ジンズ"],
    "NO BRAND": ["ノーブランド", "JEWELRY（NO BRAND）", "JEWELRY(NO BRAND)", "ブランド不明", "ノンブランド"],
    "OTHERS": ["その他"]
  };
  var BRAND_KEY = {};     // key(別表記) → 正規名
  var LATIN_PATTERNS = []; // [正規名, RegExp]（英字表記は単語境界で判定）
  var JP_KEYS = [];        // [key, 正規名]（カナ等は部分一致・長い順）
  (function buildBrand() {
    Object.keys(BRANDS).forEach(function (canon) {
      var list = [canon].concat(BRANDS[canon]);
      list.forEach(function (a) {
        var k = key(a);
        if (k) BRAND_KEY[k] = canon;
        var u = up(a);
        if (/^[A-Z0-9 .&\-'’É℃]+$/.test(u) && u.replace(/[^A-Z0-9]/g, "").length >= 3) {
          var re = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s.&\-]+/g, "[\\s.&\\-]*");
          LATIN_PATTERNS.push([canon, new RegExp("(^|[^A-Z0-9])" + re + "(?![A-Z0-9])")]);
        } else if (k.length >= 2 && !/^[A-Z0-9]+$/.test(k)) {
          JP_KEYS.push([k, canon]);
        }
      });
    });
    JP_KEYS.sort(function (a, b) { return b[0].length - a[0].length; });
  })();
  // ブランド列の値 → 正規名（辞書外は大文字そのまま）
  function canonBrand(s) {
    var k = key(s);
    if (!k) return "";
    if (BRAND_KEY[k]) return BRAND_KEY[k];
    return up(s);
  }
  // 商品名などの自由文からブランドを拾う
  function brandFromText(text) {
    var u = up(text); if (!u) return "";
    var k = key(text);
    for (var i = 0; i < JP_KEYS.length; i++) if (k.indexOf(JP_KEYS[i][0]) >= 0) return JP_KEYS[i][1];
    for (var j = 0; j < LATIN_PATTERNS.length; j++) if (LATIN_PATTERNS[j][1].test(u)) return LATIN_PATTERNS[j][0];
    return "";
  }
  function isGenericBrand(b) { return !b || b === "OTHERS" || b === "NO BRAND" || b === "衣類" || b === "不明"; }

  /* ---------------- 品目（カテゴリ）辞書 ---------------- */
  // [正規品目, 大分類, キーワード…]。マッチは「最も長いキーワード」優先
  var CATS = [
    ["長財布", "財布・小物", "長財布", "ジッピーウォレット", "ラウンドファスナー長財布", "札入れ", "ロングウォレット"],
    ["折財布", "財布・小物", "折財布", "折り財布", "二つ折り財布", "三つ折り財布", "二つ折財布", "三つ折財布", "コンパクトウォレット", "ミニ財布", "ミニウォレット", "がま口財布", "二つ折り", "三つ折り"],
    ["財布", "財布・小物", "財布", "ウォレット", "WALLET", "ポルトフォイユ"],
    ["小物ケース", "財布・小物", "コインケース", "カードケース", "キーケース", "パスケース", "名刺入れ", "小銭入れ", "キーホルダー", "キーリング", "バッグチャーム", "チャーム", "ポーチ", "スマホケース", "手帳カバー", "ポルトモネ", "コインパース", "ペンケース", "化粧ポーチ"],
    ["ショルダーバッグ", "バッグ", "ショルダーバッグ", "ショルダー", "スマホショルダー", "クロスボディ", "ボディバッグ", "ウエストバッグ", "ウエストポーチ", "メッセンジャー", "クロスバッグ", "サコッシュ"],
    ["ハンドバッグ", "バッグ", "ハンドバッグ", "ミニバッグ", "ハンド"],
    ["トートバッグ", "バッグ", "トートバッグ", "トート"],
    ["ボストンバッグ", "バッグ", "ボストンバッグ", "ボストン", "トラベルバッグ", "キャリーバッグ", "キャリー"],
    ["リュック", "バッグ", "リュック", "バックパック", "デイパック"],
    ["クラッチ・セカンド", "バッグ", "セカンドバッグ", "クラッチバッグ", "クラッチ", "セカンド"],
    ["バッグその他", "バッグ", "バッグ", "BAG", "カゴバッグ", "かごバッグ", "ビジネスバッグ", "ブリーフケース", "バニティ"],
    ["ネックレス", "アクセサリー", "ネックレス", "ペンダント", "チョーカー", "ネックレス・ペンダント"],
    ["リング", "アクセサリー", "リング", "指輪"],
    ["ブレスレット", "アクセサリー", "ブレスレット", "バングル", "アンクレット", "ブレスレット・バングル"],
    ["ピアス・イヤリング", "アクセサリー", "ピアス", "イヤリング", "イヤーカフ"],
    ["アクセサリーその他", "アクセサリー", "カフス", "タイピン", "ネクタイピン", "ブローチ", "バレッタ", "ヘアアクセ", "ヘアゴム", "ヘアピン", "ピンバッジ", "アクセサリー", "ジュエリー", "貴金属", "チェーン", "カフス・ネクタイピン"],
    ["時計", "時計", "腕時計", "時計", "ウォッチ", "WATCH"],
    ["スカーフ・ストール", "服飾小物", "スカーフ", "カレ", "ストール", "ショール", "マフラー", "バンダナ", "ツイリー", "マフラー・ストール", "カレ・スカーフ"],
    ["ネクタイ", "服飾小物", "ネクタイ"],
    ["ベルト", "服飾小物", "ベルト", "バックル", "ベルト・バックル"],
    ["帽子", "服飾小物", "帽子", "キャップ", "ハット", "ベレー", "ニット帽"],
    ["サングラス・眼鏡", "服飾小物", "サングラス", "メガネ", "眼鏡", "アイウェア"],
    ["服飾小物その他", "服飾小物", "手袋", "グローブ", "ハンカチ", "傘", "扇子", "コスメ", "香水", "ミラー", "鏡", "ライター", "ボールペン", "万年筆", "キャンドル", "食器", "グラス", "プレート", "カップ", "置物", "小物", "小物・アクセサリー", "ノベルティ"],
    ["スニーカー", "靴", "スニーカー"],
    ["ブーツ", "靴", "ブーツ", "ムートンブーツ", "ショートブーツ", "ロングブーツ"],
    ["パンプス・サンダル", "靴", "パンプス", "サンダル", "ミュール", "フラットシューズ", "バレエシューズ"],
    ["靴その他", "靴", "ローファー", "スリッポン", "レザーシューズ", "革靴", "ドライビングシューズ", "シューズ", "靴", "モカシン", "ビジネスシューズ"],
    ["コート", "アパレル", "コート", "トレンチコート", "トレンチ", "ダッフル"],
    ["ダウン", "アパレル", "ダウンジャケット", "ダウンコート", "ダウンベスト", "ダウン", "中綿", "ダウンジャケット・コート"],
    ["ジャケット・ブルゾン", "アパレル", "ジャケット", "ブルゾン", "シャケット", "ジャンバー", "ジャンパー", "ナイロンジャケット", "ライダース", "MA-1", "ジャケット・ブルゾン", "シャケット・ブルゾン"],
    ["ワンピース", "アパレル", "ワンピース", "ドレス", "ワンピ"],
    ["セットアップ", "アパレル", "セットアップ", "スーツ", "スーツ・セットアップ"],
    ["トップス・ニット", "アパレル", "ニット", "セーター", "カーディガン", "アンサンブル", "ベスト", "トップス", "ブラウス", "カットソー", "チュニック", "キャミソール", "タンクトップ", "ニット・セーター", "キャミソール・チュニック"],
    ["Tシャツ・シャツ", "アパレル", "Tシャツ", "ロンT", "ポロシャツ", "シャツ", "TEE"],
    ["パーカー・スウェット", "アパレル", "パーカー", "スウェット", "トレーナー", "ジャージ", "フーディ", "パーカ", "ジャージ・スウェット"],
    ["パンツ・スカート", "アパレル", "パンツ", "デニム", "ジーンズ", "スカート", "スラックス", "ショートパンツ", "レギンス"],
    ["アパレルその他", "アパレル", "衣類", "レディース", "メンズ", "アパレル", "水着", "ルームウェア", "キッズ"],
    ["その他", "その他", "その他", "お楽しみ", "デジカメ", "カメラ", "家電", "レコード", "本"]
  ];
  var CAT_KW = []; // [key(keyword), cat, group]
  var CAT_GROUP = {};
  var CAT_LIST = [];
  (function buildCat() {
    CATS.forEach(function (c) {
      CAT_GROUP[c[0]] = c[1]; CAT_LIST.push(c[0]);
      for (var i = 2; i < c.length; i++) CAT_KW.push([key(c[i]), c[0], c[1]]);
    });
    CAT_KW.sort(function (a, b) { return b[0].length - a[0].length; });
  })();
  var GENRE_FALLBACK = { "バッグ": "バッグその他", "ジュエリー": "アクセサリーその他", "小物・アクセサリー": "服飾小物その他", "時計": "時計", "衣類": "アパレルその他", "食器": "服飾小物その他", "靴": "靴その他", "アパレル": "アパレルその他", "小物": "服飾小物その他", "毛皮": "コート" };
  function catOf(text) {
    var k = key(text); if (!k) return null;
    for (var i = 0; i < CAT_KW.length; i++) if (k.indexOf(CAT_KW[i][0]) >= 0) return CAT_KW[i][1];
    return null;
  }
  // 複数の手がかり（形状→商品名→ジャンル）から品目を決める
  function resolveCat(shape, name, genre) {
    var c = catOf(shape);
    if (!c || c === "その他") c = catOf(name) || c;
    if (!c || c === "その他") { var g = nfkc(genre); c = GENRE_FALLBACK[g] || catOf(genre) || c; }
    return c || "その他";
  }
  function groupOf(cat) { return CAT_GROUP[cat] || "その他"; }

  /* ---------------- ランク ---------------- */
  var RANK_SCORE = { "N": 6, "S": 5, "A": 4, "AB": 3.5, "B": 3, "BC": 2.5, "C": 2, "D": 1, "F": 0, "J": 0 };
  var RANK_LABELS = [[6, "N"], [5, "S"], [4, "A"], [3.5, "AB"], [3, "B"], [2.5, "BC"], [2, "C"], [1, "D"], [0, "F"]];
  function rankScore(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var s = up(v).replace(/ランク|RANK|評価|GRADE|[:：\s]/g, "");
    if (!s) return null;
    if (RANK_SCORE[s] != null) return RANK_SCORE[s];
    var m = s.match(/^(AB|BC|N|S|A|B|C|D|F)([+\-]?)(?:$|[^A-Z])/);
    if (m) { var base = RANK_SCORE[m[1]]; if (m[2] === "+") base += 0.25; if (m[2] === "-") base -= 0.25; return base; }
    if (/^1\.|^新品|未使用品?$|新品未使用|新品・未使用/.test(s)) return 6;
    if (/^2\.|未使用に近い/.test(s)) return 5;
    if (/^3\.|目立った傷/.test(s)) return 4;
    if (/^4\.|やや傷/.test(s)) return 3;
    if (/^5\.|傷や汚れあり|傷汚れあり/.test(s)) return 2;
    if (/^6\.|全体的に状態が悪い/.test(s)) return 1;
    if (/極美品/.test(s)) return 5;
    if (/美品/.test(s)) return 4;
    if (/ジャンク|難あり|リペア/.test(s)) return 1;
    if (/中古/.test(s)) return 3;
    return null;
  }
  function rankLabel(score) {
    if (score == null) return "—";
    var best = RANK_LABELS[0];
    for (var i = 0; i < RANK_LABELS.length; i++) if (Math.abs(RANK_LABELS[i][0] - score) < Math.abs(best[0] - score)) best = RANK_LABELS[i];
    return best[1];
  }

  /* ---------------- 型番 ---------------- */
  function modelOf(text) {
    var t = up(text); if (!t) return "";
    var m = t.match(/(?:^|[^A-Z0-9])([A-Z]{1,3}-?\d{4,7}[A-Z]{0,2})(?![0-9])/);
    if (!m) return "";
    return m[1].replace("-", "");
  }

  /* ---------------- 区切りテキスト解析 ---------------- */
  function parseDelimited(text) {
    text = ("" + (text || "")).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return { rows: [], delim: null };
    var tabs = 0, commas = 0;
    lines.slice(0, 12).forEach(function (l) { tabs += (l.match(/\t/g) || []).length; commas += (l.match(/,/g) || []).length; });
    var d = (tabs >= 1 && tabs >= commas / 2) ? "\t" : (commas > 0 ? "," : null);
    if (!d) return { rows: lines.map(function (l) { return l.split(/\s{2,}|\u3000+/); }), delim: "space" };
    var rows = [], row = [], cur = "", q = false, s = text;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else {
        if (c === '"') q = true;
        else if (c === d) { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else cur += c;
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return ("" + c).trim() !== ""; }); });
    return { rows: rows, delim: d };
  }

  /* ---------------- 列の自動判定 ---------------- */
  var ROLE_LABEL = { brand: "ブランド", name: "商品名", shape: "品目/形状", genre: "ジャンル", model: "型番", rank: "ランク/状態", ext: "外装", inn: "内装", price: "価格（落札/成約）", start: "スタート価格", date: "日付", id: "受付番号", result: "結果", cost: "仕入単価", est: "予想売価/メルカリ相場", url: "リンク" };
  var ROLES = Object.keys(ROLE_LABEL);
  var H = {
    brand: ["メーカー", "ブランド名", "ブランド", "BRAND", "MAKER"],
    name: ["商品名", "品名", "商品", "タイトル", "アイテム名", "ITEM", "TITLE", "NAME", "商品タイトル"],
    shape: ["形状", "品目", "カテゴリー", "カテゴリ", "CATEGORY", "SHAPE", "アイテム", "種類"],
    genre: ["ジャンル", "GENRE", "大分類"],
    model: ["型番", "品番", "モデル", "MODEL", "REF", "型式"],
    rank: ["総合評価", "評価", "ランク", "状態", "コンディション", "RANK", "GRADE", "CONDITION", "商品ランク"],
    ext: ["外装評価", "外装"],
    inn: ["内装評価", "内装"],
    price: ["落札価格", "落札額", "落札金額", "成約価格", "オークネット上成約価格", "結果価格", "落札料含価格", "卸価格=買取金額", "卸価格", "販売価格", "現在価格", "価格", "金額", "PRICE", "入札価格"],
    start: ["スタート価格", "開始価格", "スタート", "START", "開始金額"],
    date: ["開催日", "落札日", "日付", "入札日", "出品日", "DATE", "販売日"],
    id: ["受付番号", "出品番号", "管理番号", "商品番号", "商品ID", "出品ID", "NO", "ID", "番号"],
    result: ["セリ結果", "落札結果", "結果", "ステータス", "STATUS", "RESULT"],
    cost: ["仕入単価", "仕入れ単価", "仕入値", "仕入れ値", "仕入価格", "仕入れ価格", "仕入金額", "原価", "COST"],
    est: ["予想売価", "メルカリ相場", "想定売価", "相場", "予想価格", "想定売値"],
    url: ["リンク", "URL", "参考ページ", "LINK"]
  };
  function hkey(h) { return up(h).replace(/[（(].*?[)）]/g, "").replace(/[\s\-_・\.,'’&/()（）\[\]【】「」:：]/g, ""); }
  // ヘッダー行 → {role: colIndex}
  function autoMap(header) {
    var hk = header.map(hkey);
    var map = {}, used = {};
    // 1) 完全一致（優先順＝同義語の並び順）
    ROLES.forEach(function (role) {
      var syn = H[role];
      for (var i = 0; i < syn.length && map[role] == null; i++) {
        var sk = hkey(syn[i]);
        for (var c = 0; c < hk.length; c++) if (!used[c] && hk[c] === sk) { map[role] = c; used[c] = true; break; }
      }
    });
    // 2) 部分一致（ヘッダーが同義語を含む）
    ROLES.forEach(function (role) {
      if (map[role] != null) return;
      var syn = H[role];
      for (var i = 0; i < syn.length && map[role] == null; i++) {
        var sk = hkey(syn[i]); if (sk.length < 2) continue;
        for (var c = 0; c < hk.length; c++) if (!used[c] && hk[c] && hk[c].indexOf(sk) >= 0) { map[role] = c; used[c] = true; break; }
      }
    });
    return map;
  }
  // ヘッダー行の位置（先頭5行から、2役以上マップできる行）。見つからなければ -1
  function detectHeader(rows) {
    var lim = Math.min(5, rows.length);
    for (var i = 0; i < lim; i++) {
      var m = autoMap(rows[i]);
      var n = Object.keys(m).length;
      var nums = rows[i].filter(function (c) { return num(c) != null && /^[\s¥￥]*[\d,\.]+\s*円?$/.test(nfkc(c)); }).length;
      if (n >= 2 && nums <= 1) return i;
    }
    return -1;
  }
  // ヘッダー無しの推定
  function guessMap(rows) {
    var ncol = 0; rows.forEach(function (r) { if (r.length > ncol) ncol = r.length; });
    var map = {};
    var sample = rows.slice(0, 60);
    var score = [];
    for (var c = 0; c < ncol; c++) {
      var vals = sample.map(function (r) { return r[c]; }).filter(function (v) { return v != null && ("" + v).trim() !== ""; });
      var n = vals.length || 1;
      var numeric = vals.filter(function (v) { return /^[\s¥￥]*[\d,\.]+\s*円?$/.test(nfkc(v)); }).length / n;
      var ranky = vals.filter(function (v) { return rankScore(v) != null && /^[A-Za-zＡ-Ｚａ-ｚ+\-]{1,2}$|^[1-6]\./.test(nfkc(v)); }).length / n;
      var brandy = vals.filter(function (v) { return BRAND_KEY[key(v)] != null; }).length / n;
      var idy = vals.filter(function (v) { return /^\d{3}-\d{4,6}$/.test(nfkc(v)); }).length / n;
      var caty = vals.filter(function (v) { return catOf(v) != null && nfkc(v).length <= 12; }).length / n;
      var avglen = vals.reduce(function (a, v) { return a + nfkc(v).length; }, 0) / n;
      var medv = median(vals.map(num));
      score.push({ c: c, numeric: numeric, ranky: ranky, brandy: brandy, idy: idy, caty: caty, avglen: avglen, medv: medv || 0 });
    }
    function pick(role, fn) { var best = null; score.forEach(function (s) { if (Object.keys(map).some(function (r) { return map[r] === s.c; })) return; var v = fn(s); if (v != null && (best == null || v > best.v)) best = { c: s.c, v: v }; }); if (best && best.v > 0) map[role] = best.c; }
    pick("id", function (s) { return s.idy >= 0.5 ? s.idy : null; });
    pick("rank", function (s) { return s.ranky >= 0.5 ? s.ranky : null; });
    pick("brand", function (s) { return s.brandy >= 0.3 ? s.brandy : null; });
    pick("shape", function (s) { return s.caty >= 0.5 ? s.caty : null; });
    pick("price", function (s) { return s.numeric >= 0.6 ? s.medv : null; });
    pick("start", function (s) { return s.numeric >= 0.6 ? s.medv : null; });
    pick("name", function (s) { return s.numeric < 0.3 && s.avglen >= 6 ? s.avglen : null; });
    return map;
  }

  /* ---------------- 行 → 正規化レコード ---------------- */
  var UNSOLD = /流れ|不成立|落札者なし|取消|キャンセル|未成約|不可|取り下げ|出品中/;
  function cell(row, i) { return (i == null || i >= row.length) ? "" : row[i]; }
  function makeItem(row, map, opts) {
    opts = opts || {};
    var brandRaw = nfkc(cell(row, map.brand));
    var name = nfkc(cell(row, map.name));
    var shape = nfkc(cell(row, map.shape));
    var genre = nfkc(cell(row, map.genre));
    var brand = canonBrand(brandRaw);
    if (isGenericBrand(brand)) brand = brandFromText(name) || brandFromText(shape) || brand;
    if (!brand && !brandRaw) brand = brandFromText(name) || brandFromText(shape);
    var cat = resolveCat(shape, name, genre);
    var model = nfkc(cell(row, map.model)).toUpperCase().replace(/\s/g, "") || modelOf(name) || modelOf(shape);
    var rankRaw = nfkc(cell(row, map.rank));
    var rank = rankScore(rankRaw);
    var it = {
      id: nfkc(cell(row, map.id)), brand: brand, brandRaw: brandRaw, name: name || shape, shape: shape, genre: genre,
      cat: cat, grp: groupOf(cat), model: model, rank: rank, rankRaw: rankRaw,
      ext: nfkc(cell(row, map.ext)), inn: nfkc(cell(row, map.inn)),
      price: num(cell(row, map.price)), start: num(cell(row, map.start)), date: nfkc(cell(row, map.date)),
      result: nfkc(cell(row, map.result)), cost: num(cell(row, map.cost)), est: parseRange(cell(row, map.est)), url: nfkc(cell(row, map.url))
    };
    return it;
  }
  // 相場データ（市場側）用：価格が無い/不成立は捨てる
  function toRecords(rows, map, market, opts) {
    opts = opts || {};
    var out = [], skipped = 0;
    for (var i = 0; i < rows.length; i++) {
      var it = makeItem(rows[i], map, opts);
      var price = it.price;
      if (price == null && opts.fallbackStart) price = it.start;
      if (opts.priceDivisor && price != null) price = Math.round(price / opts.priceDivisor);
      if (price == null || price <= 0 || (it.result && UNSOLD.test(it.result) && !/落札|成約/.test(it.result))) { skipped++; continue; }
      if (!it.brand && !it.name) { skipped++; continue; }
      out.push({ mk: market, id: it.id, brand: it.brand, cat: it.cat, grp: it.grp, model: it.model, name: it.name, rank: it.rank, rankRaw: it.rankRaw, price: price, date: it.date, src: opts.src || "import" });
    }
    return { recs: out, skipped: skipped };
  }
  function dedupeKey(r) { return r.mk + "|" + (r.id ? ("#" + r.id) : (r.brand + "|" + r.name + "|" + r.price + "|" + r.date)); }

  /* ---------------- 統計 ---------------- */
  function stats(prices) {
    var a = prices.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; });
    var n = a.length; if (!n) return null;
    var b = a;
    if (n >= 10) { var k = Math.floor(n * 0.05); b = a.slice(k, n - k); }
    function q(p) { var i = (b.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); }
    return { n: n, med: Math.round(q(0.5)), q1: Math.round(q(0.25)), q3: Math.round(q(0.75)), min: a[0], max: a[n - 1] };
  }
  function statsOf(comps) {
    if (comps.length === 1 && comps[0].agg) {
      var g = comps[0].agg;
      return { n: g.n, med: Math.round(g.med != null ? g.med : comps[0].price), q1: g.q1 != null ? g.q1 : g.min, q3: g.q3 != null ? g.q3 : g.max, min: g.min, max: g.max, agg: true, rankMed: g.rankMed != null ? g.rankMed : null };
    }
    return stats(comps.map(function (c) { return c.price; }));
  }

  /* ---------------- 相場マッチング ---------------- */
  var LEVEL_LABEL = { 1: "型番一致", 2: "ブランド×品目×同ランク", 3: "ブランド×品目（ランク補正）", 4: "ブランド×大分類（参考）", 9: "推定（係数換算）" };
  var CAT_FAMILY = { "長財布": "財布", "折財布": "財布", "財布": "財布" };
  // 市場ごとのランク補正（例：オークネットは評価が厳しいので +1 段で他市場と揃える）
  function rankOffset(mk, s) { var m = s && s.markets && s.markets[mk]; return (m && m.rankOffset) || 0; }
  function recRank(r, s) { return r.rank == null ? null : r.rank + rankOffset(r.mk, s); }
  // 集計レコード（初期データ）用：kind = model / catrank / cat / grp
  function aggKind(r) { return (r.agg && r.agg.kind) || "cat"; }
  function findAggComps(aggs, item, s) {
    var model = item.model, cat = item.cat, grp = item.grp, rank = item.rank;
    function pick(list) { if (!list.length) return null; list.sort(function (a, b) { return b.agg.n - a.agg.n; }); return list[0]; }
    if (model) { var m = pick(aggs.filter(function (r) { return aggKind(r) === "model" && r.model === model; })); if (m) return { level: 1, comps: [m] }; }
    if (rank != null) { var cr = pick(aggs.filter(function (r) { var rr = recRank(r, s); return aggKind(r) === "catrank" && r.cat === cat && rr != null && Math.abs(rr - rank) <= 0.5 && r.agg.n >= 3; })); if (cr) return { level: 2, comps: [cr] }; }
    var c = pick(aggs.filter(function (r) { return aggKind(r) === "cat" && r.cat === cat && r.agg.n >= 1; })); if (c) return { level: 3, comps: [c] };
    var fam = CAT_FAMILY[cat];
    if (fam) { var f = pick(aggs.filter(function (r) { return aggKind(r) === "cat" && CAT_FAMILY[r.cat] === fam && r.agg.n >= 2; })); if (f) return { level: 3, comps: [f], fam: true }; }
    var g = pick(aggs.filter(function (r) { return aggKind(r) === "grp" && r.grp === grp && grp !== "その他" && r.agg.n >= 3; })); if (g) return { level: 4, comps: [g] };
    return null;
  }
  function findComps(recs, item, s) {
    if (!recs || !recs.length || !item.brand) return null;
    var all = recs.filter(function (r) { return r.brand === item.brand; });
    if (!all.length) return null;
    var items = [], aggs = [];
    all.forEach(function (r) { (r.agg ? aggs : items).push(r); });
    var fi = items.length ? findItemComps(items, item, s) : null;
    var fa = aggs.length ? findAggComps(aggs, item, s) : null;
    if (fi && fa) return fa.level < fi.level ? fa : fi; // 個別データ優先、集計の方が精密な時だけ集計
    return fi || fa;
  }
  function findItemComps(byBrand, item, s) {
    var cat = item.cat, grp = item.grp, model = item.model, rank = item.rank;
    if (model) {
      var l1 = byBrand.filter(function (r) { return r.model && r.model === model; });
      if (l1.length >= 1) return { level: 1, comps: l1 };
    }
    var byCat = byBrand.filter(function (r) { return r.cat === cat; });
    if (rank != null) {
      var l2 = byCat.filter(function (r) { var rr = recRank(r, s); return rr != null && Math.abs(rr - rank) <= 0.5 && !r.agg; });
      if (l2.length >= 3) return { level: 2, comps: l2 };
    }
    if (byCat.length >= 2) return { level: 3, comps: byCat };
    // 類似品目（長財布／折財布／財布 はオークネット側が「財布」で一括のことが多い）
    var fam = CAT_FAMILY[cat];
    if (fam) {
      var byFam = byBrand.filter(function (r) { return CAT_FAMILY[r.cat] === fam; });
      if (byFam.length >= 2) return { level: 3, comps: byFam, fam: true };
    }
    var byGrp = byBrand.filter(function (r) { return r.grp === grp && grp !== "その他"; });
    if (byGrp.length >= 3) return { level: 4, comps: byGrp };
    return null;
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function estimateSell(item, market, recs, s) {
    var f = findComps(recs, item, s);
    if (!f) return { ok: false, market: market, reason: item.brand ? "収録なし" : "ブランド不明" };
    var st = statsOf(f.comps);
    var gross = st.med, adj = 0;
    if (f.level >= 3 && item.rank != null) {
      // 相場側の代表ランク（集計なら rankMed、無ければ B 基準）との差で補正し、実データの範囲内に収める
      var cr = st.agg ? (st.rankMed != null ? st.rankMed + rankOffset(f.comps[0].mk, s) : 3) : median(f.comps.map(function (c) { return recRank(c, s); }));
      if (cr != null) { adj = Math.round((item.rank - cr) * 4) / 4; gross = clamp(Math.round(gross * Math.pow(s.rankStep || 1.10, adj)), st.min, st.max); }
    }
    var conf;
    if (f.level === 1) conf = st.n >= 2 ? "高" : "中";
    else if (f.level === 2) conf = st.n >= 5 ? "高" : "中";
    else if (f.level === 3) conf = st.n >= 8 ? "中" : "低";
    else conf = "低";
    return { ok: true, market: market, gross: gross, band: [Math.min(st.q1, gross), Math.max(st.q3, gross)], n: st.n, level: f.level, label: LEVEL_LABEL[f.level] + (f.fam ? "・財布類まとめ" : ""), conf: conf, adj: adj, comps: f.comps.slice(0, 40), agg: !!st.agg };
  }

  /* ---------------- 市場と手数料 ---------------- */
  var MARKETS = {
    ecoauc: { name: "エコオク（エコリング the オークション）", short: "エコオク", roles: ["buy", "sell"] },
    aucnet: { name: "オークネット ブランドオークション", short: "オークネット", roles: ["buy", "sell"] },
    yba: { name: "YBA（アパレル業者市）", short: "YBA", roles: ["buy", "sell"] },
    mercari: { name: "メルカリ（参考・個人向け）", short: "メルカリ", roles: ["sell"] }
  };
  var DEFAULT_SETTINGS = {
    v: 1,
    tax: 0.10,
    targetRoi: 0.30, minProfit: 5000, okRoi: 0.15, okProfit: 3000,
    rankStep: 1.10,          // ランク1段差の価格差（10%）
    exitPrefer: 0.70,        // 業者オクの手残りがメルカリの何割以上なら「即換金」を勧めるか
    exitTier1: 0.80, exitTier2: 0.60, exitTier3: 0.45, // メルカリ相場→業者オク落札の換算係数（実データが無い時のみ）
    markets: {
      ecoauc: { buyTiers: [[10000, 500], [49999, 1000], [99999, 2000], [1e12, 3000]], sellTiers: [[10000, 500], [49999, 1000], [99999, 2000], [1e12, 3000]], shipIn: 1000, shipOut: 1000, extraSell: 0, rankOffset: 0 },
      aucnet: { buyRate: 0.04, buyMin: 500, sellRate: 0.03, sellMin: 500, shipIn: 600, shipOut: 1000, extraSell: 0, rankOffset: 1, oroshiRatio: 1.10 },
      yba: { buyRate: 0, buyMin: 0, sellRate: 0, sellMin: 0, shipIn: 0, shipOut: 800, extraSell: 0, rankOffset: 0 },
      mercari: { sellRate: 0.10, shipByGroup: { "バッグ": 750, "靴": 750, "アパレル": 750, "財布・小物": 215, "アクセサリー": 215, "服飾小物": 215, "時計": 380, "その他": 380 }, shipOut: 380, rankOffset: 0 }
    },
    fixed: { aucnetMonthly: 16000, ecoaucYearly: 20000, monthlyItems: 0 }
  };
  function deepMerge(base, over) {
    if (over == null || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
    var out = {};
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over).forEach(function (k) {
      if (base && typeof base[k] === "object" && base[k] && !Array.isArray(base[k]) && typeof over[k] === "object" && over[k] && !Array.isArray(over[k])) out[k] = deepMerge(base[k], over[k]);
      else out[k] = over[k];
    });
    return out;
  }
  function tierFee(tiers, x) {
    for (var i = 0; i < tiers.length; i++) if (x <= tiers[i][0]) return tiers[i][1];
    return tiers[tiers.length - 1][1];
  }
  function buyerFee(mk, h, s) {
    var m = s.markets[mk]; if (!m || !h) return 0;
    if (m.buyTiers) return tierFee(m.buyTiers, h);
    var f = Math.round(h * (m.buyRate || 0));
    if (m.buyMin && f < m.buyMin) f = m.buyMin;
    return f;
  }
  function sellerFee(mk, h, s) {
    var m = s.markets[mk]; if (!m || !h) return 0;
    if (m.sellTiers) return tierFee(m.sellTiers, h);
    var f = Math.round(h * (m.sellRate || 0));
    if (m.sellMin && f < m.sellMin) f = m.sellMin;
    return f;
  }
  function shipIn(mk, s) { var m = s.markets[mk]; return m ? (m.shipIn || 0) : 0; }
  function shipOut(mk, grp, s) {
    var m = s.markets[mk]; if (!m) return 0;
    if (m.shipByGroup && m.shipByGroup[grp] != null) return m.shipByGroup[grp];
    return m.shipOut || 0;
  }
  function fixedPerItem(s) {
    var n = s.fixed && s.fixed.monthlyItems; if (!n || n <= 0) return 0;
    var monthly = (s.fixed.aucnetMonthly || 0) + (s.fixed.ecoaucYearly || 0) / 12;
    return Math.round(monthly / n);
  }
  // 仕入れ総額（税抜）＝落札額＋買い手数料＋入荷送料
  function landed(mk, h, s) { return Math.round(h + buyerFee(mk, h, s) + shipIn(mk, s)); }
  // 手残り（税抜）＝売値−売り手数料−出荷送料−その他
  function net(mk, h, grp, s) { var m = s.markets[mk] || {}; return Math.round(h - sellerFee(mk, h, s) - shipOut(mk, grp, s) - (m.extraSell || 0)); }
  // 目標ROIを満たす上限入札額（100円単位に切り下げ）
  function maxBid(sellGross, sellMk, buyMk, grp, s, roi) {
    if (sellGross == null) return null;
    var n = net(sellMk, sellGross, grp, s);
    var target = n / (1 + (roi == null ? s.targetRoi : roi)) - fixedPerItem(s);
    var h = target - shipIn(buyMk, s);
    for (var i = 0; i < 8; i++) h = target - shipIn(buyMk, s) - buyerFee(buyMk, Math.max(h, 0), s);
    h = Math.floor(h / 100) * 100;
    return h > 0 ? h : 0;
  }
  function judge(profit, roi, s) {
    if (profit == null || roi == null) return { mark: "—", cls: "na", label: "判定不可" };
    if (roi >= s.targetRoi && profit >= s.minProfit) return { mark: "◎", cls: "best", label: "買い" };
    if (roi >= s.okRoi && profit >= s.okProfit) return { mark: "○", cls: "good", label: "条件次第" };
    if (profit > 0) return { mark: "△", cls: "thin", label: "薄利" };
    return { mark: "×", cls: "bad", label: "見送り" };
  }
  // 1点を評価：販売市場の相場 → 手残り → 上限入札額／入札額があれば粗利・ROI・判定
  function evaluate(item, buyMk, bid, sellMk, data, s) {
    var est = estimateSell(item, sellMk, (data && data[sellMk]) || [], s);
    var out = { item: item, buyMk: buyMk, sellMk: sellMk, est: est };
    if (!est.ok) { out.judge = { mark: "—", cls: "na", label: "相場なし" }; return out; }
    out.net = net(sellMk, est.gross, item.grp, s);
    out.netLo = net(sellMk, est.band[0], item.grp, s);
    out.maxBid = maxBid(est.gross, sellMk, buyMk, item.grp, s);
    out.maxBidLo = maxBid(est.band[0], sellMk, buyMk, item.grp, s);
    var h = (bid != null && bid > 0) ? bid : ((item.start != null && item.start > 0) ? item.start : null);
    if (h != null) {
      out.bid = h; out.bidIsStart = !(bid != null && bid > 0);
      out.landed = landed(buyMk, h, s) + fixedPerItem(s);
      out.landedTax = Math.round(out.landed * (1 + s.tax));
      out.profit = out.net - out.landed;
      out.roi = out.landed > 0 ? out.profit / out.landed : null;
      out.judge = judge(out.profit, out.roi, s);
    } else {
      out.judge = out.maxBid > 0 ? { mark: "入", cls: "info", label: "上限" + yen(out.maxBid) + "まで" } : { mark: "×", cls: "bad", label: "採算なし" };
    }
    return out;
  }

  /* ---------------- Re:che 出口判定 ---------------- */
  var TIER1 = { "HERMES": 1, "CHANEL": 1, "LOUIS VUITTON": 1, "ROLEX": 1, "CARTIER": 1 };
  var TIER2 = { "GUCCI": 1, "PRADA": 1, "DIOR": 1, "CELINE": 1, "FENDI": 1, "LOEWE": 1, "BOTTEGA VENETA": 1, "SAINT LAURENT": 1, "BVLGARI": 1, "TIFFANY": 1, "BURBERRY": 1, "BALENCIAGA": 1, "VALENTINO": 1, "GIVENCHY": 1, "MIU MIU": 1, "CHLOE": 1, "SALVATORE FERRAGAMO": 1, "OMEGA": 1, "GOYARD": 1, "MONCLER": 1 };
  function exitRatio(brand, s) { if (TIER1[brand]) return s.exitTier1; if (TIER2[brand]) return s.exitTier2; return s.exitTier3; }
  function exitCompare(item, data, s) {
    var out = { item: item };
    var auc = estimateSell(item, "aucnet", (data && data.aucnet) || [], s);
    if (!auc.ok && item.est != null && item.est > 0) {
      var ratio = exitRatio(item.brand, s);
      auc = { ok: true, market: "aucnet", gross: Math.round(item.est * ratio), band: [Math.round(item.est * ratio * 0.8), Math.round(item.est * ratio * 1.2)], n: 0, level: 9, label: "メルカリ相場×" + ratio, conf: "推定", agg: false, comps: [] };
    }
    out.auc = auc;
    if (auc.ok) {
      out.aucNet = net("aucnet", auc.gross, item.grp, s);
      out.aucNetLo = net("aucnet", auc.band[0], item.grp, s);
      if (item.cost != null) { out.aucProfit = out.aucNet - item.cost; out.aucRoi = item.cost > 0 ? out.aucProfit / item.cost : null; }
    }
    var mGross = (item.est != null && item.est > 0) ? item.est : null, mSrc = "入力値";
    if (mGross == null && data && data.mercari && data.mercari.length) { var me = estimateSell(item, "mercari", data.mercari, s); if (me.ok) { mGross = me.gross; mSrc = "実売データ"; } }
    out.merGross = mGross; out.merSrc = mSrc;
    if (mGross != null) {
      out.merNet = net("mercari", mGross, item.grp, s);
      if (item.cost != null) { out.merProfit = out.merNet - item.cost; out.merRoi = item.cost > 0 ? out.merProfit / item.cost : null; }
    }
    // おすすめ
    if (!auc.ok && mGross == null) out.advice = { cls: "na", text: "相場不明。メルカリの売切相場を入れると判定できます" };
    else if (auc.ok && out.aucProfit != null && out.aucProfit >= 0 && (out.merNet == null || out.aucNet >= out.merNet * s.exitPrefer)) out.advice = { cls: "best", text: "業者オクで即換金OK（手残り差が小さい・回転優先）" };
    else if (auc.ok && out.aucProfit != null && out.aucProfit >= 0) out.advice = { cls: "good", text: "まずメルカリで売る。売れ残ったら業者オクへ（赤字にはならない）" };
    else if (auc.ok && out.aucProfit != null) out.advice = { cls: "bad", text: "業者オクは赤字。メルカリ一本か損切りの判断" };
    else if (auc.ok) out.advice = { cls: "info", text: "仕入単価を入れると粗利が出ます" };
    else out.advice = { cls: "info", text: "業者オク相場なし。メルカリ相場から推定するには予想売価を入れてください" };
    return out;
  }

  /* ---------------- CSV 生成 ---------------- */
  function csvLine(arr) {
    return arr.map(function (v) { v = v == null ? "" : "" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
  }
  function toCSV(rows) { return "\uFEFF" + rows.map(csvLine).join("\r\n"); }
  function toTSV(rows) { return rows.map(function (r) { return r.map(function (v) { return (v == null ? "" : "" + v).replace(/[\t\r\n]+/g, " "); }).join("\t"); }).join("\n"); }

  return {
    VERSION: VERSION,
    nfkc: nfkc, up: up, key: key, esc: esc, num: num, parseRange: parseRange, yen: yen, pct: pct, median: median,
    BRANDS: BRANDS, canonBrand: canonBrand, brandFromText: brandFromText, isGenericBrand: isGenericBrand,
    CATS: CATS, CAT_LIST: CAT_LIST, catOf: catOf, resolveCat: resolveCat, groupOf: groupOf,
    rankScore: rankScore, rankLabel: rankLabel, modelOf: modelOf,
    parseDelimited: parseDelimited, autoMap: autoMap, detectHeader: detectHeader, guessMap: guessMap, ROLE_LABEL: ROLE_LABEL, ROLES: ROLES,
    makeItem: makeItem, toRecords: toRecords, dedupeKey: dedupeKey,
    stats: stats, findComps: findComps, estimateSell: estimateSell, LEVEL_LABEL: LEVEL_LABEL,
    MARKETS: MARKETS, DEFAULT_SETTINGS: DEFAULT_SETTINGS, deepMerge: deepMerge,
    buyerFee: buyerFee, sellerFee: sellerFee, shipIn: shipIn, shipOut: shipOut, landed: landed, net: net, maxBid: maxBid, judge: judge, evaluate: evaluate, fixedPerItem: fixedPerItem,
    exitRatio: exitRatio, exitCompare: exitCompare,
    toCSV: toCSV, toTSV: toTSV
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = BTOB;
