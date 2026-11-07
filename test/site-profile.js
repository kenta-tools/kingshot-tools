// 「鯖全体用」と「EGG同盟員用」の出し分け設定（config.js と同じ発想：ロジックは全ページ共通、違いはここだけ）。
// データ（イベント・参加者・登録）と中継役（GAS）は両サイトで共有。パスワードも分けない。
// 出し分けるのは見た目・操作だけ（表示するイベント種別・TOPのカード）。URLを直接開けば他方のページも使える。
//
// どちらのサイトか：URLの ?site=egg|all → 最後に開いたサイトの記憶（localStorage ksSite）→ 既定 all
//   ・TOP（/）を開くと all、EGG用TOP（/egg/）を開くと egg を記憶する（window.KS_SITE_FORCE で指定）
// 使い方：KS_SITE.eventTypes / KS_SITE.hasType(type) / KS_SITE.hasFeature(name) / KS_SITE.filterEvents(list)
(function() {
  // type: イベント種別（admin/admin-common.js の EVENT_TYPES の部分集合）
  // features: 使える機能。サイト別にOFFにしたいときは一覧から外す（TOPのカードの data-feature と対応）
  //   tools ツール一覧／flame ランキング（炎龍）／league ランキング（聖剣リーグ）／entry 参加登録／teams チーム分け／inquiry 問い合わせ／admin 管理／spec 仕様まとめ
  var ALL_FEATURES = ["tools", "flame", "league", "entry", "teams", "inquiry", "admin", "spec"];
  var PROFILES = {
    all: { id: "all", name: "鯖全体用", eventTypes: ["KVK", "炎龍", "聖剣リーグ"], features: ALL_FEATURES },
    egg: { id: "egg", name: "EGG同盟員用", eventTypes: ["KVK", "聖剣", "聖剣リーグ", "三盟", "炎龍", "遺跡争奪"], features: ALL_FEATURES }
  };

  var id = "";
  try { id = new URLSearchParams(location.search).get("site") || ""; } catch (e) {}
  if (!PROFILES[id]) id = (typeof window.KS_SITE_FORCE === "string" && PROFILES[window.KS_SITE_FORCE]) ? window.KS_SITE_FORCE : "";
  var fromUrl = !!id;
  if (!id) { try { id = localStorage.getItem("ksSite") || ""; } catch (e) {} }
  if (!PROFILES[id]) id = "all";
  // URLの指定（?site=）か、TOPを開いたとき（KS_SITE_FORCE）だけ記憶を更新する。個別ページを直接開いても記憶は変えない
  if (fromUrl) { try { localStorage.setItem("ksSite", id); } catch (e) {} }

  var p = PROFILES[id];
  window.KS_SITE = {
    id: p.id,
    name: p.name,
    eventTypes: p.eventTypes.slice(),
    features: p.features.slice(),
    hasType: function(t) { return p.eventTypes.indexOf(t) >= 0; },
    hasFeature: function(f) { return p.features.indexOf(f) >= 0; },
    // イベント一覧（{type:…}を持つもの）をこのサイトの種別だけに絞る。データは変えない（表示用）
    filterEvents: function(list) { return (list || []).filter(function(e) { return p.eventTypes.indexOf(e.type) >= 0; }); }
  };

  // EGG用のときだけ：ページ内の「TOPへ戻る」リンクを EGG用TOP（/egg/）に向ける
  if (p.id === "egg") {
    var cur = document.currentScript, base = cur && cur.src ? cur.src.replace(/site-profile\.js.*$/, "") : "";
    document.addEventListener("DOMContentLoaded", function() {
      if (!base) return;
      Array.prototype.forEach.call(document.querySelectorAll("a[href]"), function(a) {
        var u = a.href.split("#")[0].split("?")[0];
        if (u === base || u === base + "index.html") a.href = base + "egg/";
      });
    });
  }
})();
