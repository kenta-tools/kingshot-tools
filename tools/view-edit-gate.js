// tools/配下のツールを「閲覧モード（既定）」と「編集可モード」に分ける。
// ログインはTOPページ（index.html）だけで行う（ここでは行わない）。TOPで管理者パスワードを入れて
// ログインすると、同じタブのtools/配下すべてが編集可になる（sessionStorage ksAdminPw を共有。
// 管理画面・KvK相手突合せと同じキーなので、どこでログインしても全部に効く）。
//
// 閲覧モード中でも、イベント選択（#eventSelect）・自分用/共有用の切り替えボタン・サイドバーの開閉は
// 常に使える（class="ve-exempt"を付けたもの、またはbody.ve-personal-mode配下）。
// 「自分用（このブラウザだけ）」表示中は、ブラウザだけに保存するだけで共有データに触れないため、
// 各ツールのJSがbody.ve-personal-modeを付け、入力欄も常に使えるようにしている。
//
// 入力禁止はCSS（body.ve-view-mode配下のinput/select/textarea/buttonをpointer-events:none）で行う。
// 周期ウェーブタイマーのように毎フレームDOMを再構築するツールでも、セレクタで効くので
// 要素ごとにdisabledを付け直す必要がない。
//
// 使い方：対応ページの</body>の直前に <script src="view-edit-gate.js"></script> を入れる。
(function () {
  "use strict";
  var ADMIN_PW_KEY = "ksAdminPw";

  var STYLE = [
    "body.ve-view-mode input, body.ve-view-mode select, body.ve-view-mode textarea, body.ve-view-mode button {",
    "  pointer-events: none !important;",
    "  opacity: 0.55;",
    "  filter: grayscale(30%);",
    "}",
    "body.ve-view-mode .ve-exempt,",
    "body.ve-view-mode .ks-sidebar input, body.ve-view-mode .ks-sidebar button,",
    "body.ve-view-mode .ve-badge input, body.ve-view-mode .ve-badge button,",
    "body.ve-view-mode.ve-personal-mode input, body.ve-view-mode.ve-personal-mode select,",
    "body.ve-view-mode.ve-personal-mode textarea, body.ve-view-mode.ve-personal-mode button {",
    "  pointer-events: auto !important;",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    ".ve-badge { position: fixed; bottom: 14px; right: 14px; z-index: 100000; font-family: 'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif; }",
  ].join("\n");

  function isEditable() {
    try {
      return !!sessionStorage.getItem(ADMIN_PW_KEY);
    } catch (e) {
      return false;
    }
  }

  function applyMode() {
    document.body.classList.toggle("ve-view-mode", !isEditable());
  }

  function renderBadge() {
    var badge = document.createElement("div");
    badge.className = "ve-badge";
    if (isEditable()) {
      badge.innerHTML =
        '<div style="background:#fff; border:1px solid #cfe8d8; border-radius:999px; padding:7px 14px; box-shadow:0 2px 8px rgba(0,0,0,0.12); font-size:12px; color:#1e7d3a; font-weight:bold;">🔓 編集可モード</div>';
    } else {
      badge.innerHTML =
        '<a href="../index.html" style="display:block; text-decoration:none; font-size:12px; padding:8px 16px; border-radius:999px; border:1px solid #ccc; background:#fff; color:#555; box-shadow:0 2px 8px rgba(0,0,0,0.12);">🔒 閲覧モード（編集はTOPからログイン）</a>';
    }
    document.body.appendChild(badge);
  }

  var styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  applyMode();
  renderBadge();
})();
