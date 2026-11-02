// KvK相手突合せ（kvk-matchup/配下）の認証ゲート。
// admin/配下（events.html・participants.html・users.html・logs.html）と同じ中継役（GAS）・同じパスワード・同じsessionStorageキーを使うので、
// 同じタブでadmin側から遷移してきた場合は再ログイン不要（sessionStorageはタブ単位で同一オリジンなら引き継がれる）。
// 使い方：対応ページの<head>先頭に
//   <script>(function(){try{if(!sessionStorage.getItem('ksAdminPw'))document.documentElement.style.visibility='hidden';}catch(e){document.documentElement.style.visibility='hidden';}})();</script>
// を入れ、</body>の直前に <script src="kvk-auth-gate.js"></script> を入れる。
(function () {
  "use strict";
  var PW_KEY = "ksAdminPw";
  var GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec";

  function isAuthed() {
    try {
      return !!sessionStorage.getItem(PW_KEY);
    } catch (e) {
      return false;
    }
  }

  // ---------- 左サイドバー（admin/配下と同じ見た目。admin-common.jsのrenderAdminSidebarと同じCSS） ----------
  var SIDEBAR_CSS = [
    ".ks-sidebar { position: fixed; top: 0; left: 0; width: 220px; height: 100vh; background: #1a2332; padding: 20px 14px; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; font-family: 'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif; z-index: 99999; transition: width 0.2s ease; }",
    ".ks-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }",
    ".ks-sidebar .ks-title { color: #fff; font-weight: bold; font-size: 14px; white-space: nowrap; flex: 1; overflow: hidden; }",
    ".ks-toggle-btn { background: transparent; border: 1px solid #3a4a63; color: #c7d0dd; border-radius: 5px; width: 24px; height: 24px; font-size: 13px; line-height: 1; cursor: pointer; flex: 0 0 auto; }",
    ".ks-toggle-btn:hover { background: #2a374d; }",
    ".ks-sidebar nav { display: flex; flex-direction: column; }",
    ".ks-sidebar .ks-link { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 6px; margin-bottom: 2px; text-decoration: none; font-size: 12px; line-height: 1.35; color: #c7d0dd; }",
    ".ks-sidebar button.ks-link { background: none; border: none; font: inherit; width: 100%; text-align: left; cursor: pointer; }",
    ".ks-sidebar .ks-link .ks-icon { flex: 0 0 auto; width: 18px; text-align: center; margin-top: 1px; }",
    ".ks-sidebar .ks-link .ks-label { white-space: normal; overflow-wrap: break-word; }",
    ".ks-sidebar .ks-link.ks-active { background: #3a4a63; color: #fff; font-weight: bold; }",
    ".ks-sidebar .ks-group { height: 1px; background: #2a374d; margin: 10px 4px; }",
    ".ks-open-btn { display: none; position: fixed; top: 14px; left: 14px; z-index: 100001; width: 34px; height: 34px; border-radius: 8px; border: none; background: #1a2332; color: #fff; font-size: 16px; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }",
    "body.has-admin-sidebar { margin-left: 240px !important; transition: margin-left 0.2s ease; }",
    "body.has-admin-sidebar.ks-collapsed { margin-left: 76px !important; }",
    "body.ks-collapsed .ks-sidebar { width: 56px; padding-left: 8px; padding-right: 8px; }",
    "body.ks-collapsed .ks-sidebar .ks-title { display: none; }",
    "body.ks-collapsed .ks-title-row { justify-content: center; }",
    "body.ks-collapsed .ks-sidebar .ks-label { display: none; }",
    "body.ks-collapsed .ks-sidebar .ks-link { justify-content: center; padding: 8px 0; }",
    "@media (max-width: 760px) {",
    "  .ks-sidebar { width: 100% !important; height: auto; max-height: none; top: 0; left: 0; padding: 8px 10px !important; overflow-y: hidden; display: flex; align-items: center; gap: 8px; transition: transform 0.2s ease; }",
    "  .ks-title-row { margin-bottom: 0; }",
    "  .ks-sidebar .ks-title { font-size: 12px; flex: 0 0 auto; }",
    "  .ks-sidebar nav { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; gap: 4px; }",
    "  .ks-sidebar .ks-link { flex: 0 0 auto; white-space: nowrap; margin-bottom: 0; padding: 6px 10px; font-size: 12px; }",
    "  .ks-sidebar .ks-label { display: inline !important; }",
    "  .ks-sidebar .ks-group { display: none; }",
    "  body.has-admin-sidebar { margin-left: 0 !important; padding-top: 56px !important; }",
    "  body.has-admin-sidebar.ks-collapsed .ks-sidebar { transform: translateY(-100%); width: 100% !important; }",
    "  body.has-admin-sidebar.ks-collapsed { margin-left: 0 !important; padding-top: 0 !important; }",
    "  body.ks-collapsed .ks-open-btn { display: flex; }",
    "  .ks-open-btn { top: 8px; left: 8px; }",
    "}",
  ].join("\n");

  function renderSidebar() {
    if (document.getElementById("ksAdminSidebar")) return;
    var links = [
      ["../admin/events.html", "📅", "イベント"],
      ["../admin/participants.html", "👥", "参加者一覧"],
      ["../admin/users.html", "🗂️", "ユーザー管理"],
      ["../admin/logs.html", "🕵️", "個人登録の記録"],
    ].map(function (item) {
      return '<a href="' + item[0] + '" class="ks-link" title="' + item[2] + '">' +
        '<span class="ks-icon">' + item[1] + '</span><span class="ks-label">' + item[2] + "</span></a>";
    }).join("");

    var style = document.createElement("style");
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="ks-sidebar" id="ksAdminSidebar">' +
        '<div class="ks-title-row"><span class="ks-title">🔐 管理画面</span>' +
          '<button type="button" class="ks-toggle-btn" id="ksToggleBtn">←</button></div>' +
        "<nav>" + links +
          '<div class="ks-group"></div>' +
          '<a href="kvk-matchup-index.html" class="ks-link ks-active" title="KvK相手突合せ"><span class="ks-icon">⚔️</span><span class="ks-label">KvK相手突合せ</span></a>' +
          '<a href="../index.html" class="ks-link" title="TOP"><span class="ks-icon">🏠</span><span class="ks-label">TOP</span></a>' +
          '<button type="button" class="ks-link" id="ksLogoutBtn" title="ログアウト"><span class="ks-icon">🚪</span><span class="ks-label">ログアウト</span></button>' +
        "</nav>" +
      "</div>" +
      '<button type="button" class="ks-open-btn" id="ksOpenBtn" aria-label="メニューを開く">☰</button>';
    while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
    document.body.classList.add("has-admin-sidebar");

    var collapsed = false;
    try { collapsed = localStorage.getItem("ksAdminSidebarCollapsed") === "1"; } catch (e) {}
    function applyBtn() {
      var btn = document.getElementById("ksToggleBtn");
      if (btn) btn.textContent = document.body.classList.contains("ks-collapsed") ? "→" : "←";
    }
    if (collapsed) document.body.classList.add("ks-collapsed");
    applyBtn();
    function toggle() {
      var next = !document.body.classList.contains("ks-collapsed");
      document.body.classList.toggle("ks-collapsed", next);
      try { localStorage.setItem("ksAdminSidebarCollapsed", next ? "1" : "0"); } catch (e) {}
      applyBtn();
    }
    var toggleBtn = document.getElementById("ksToggleBtn");
    var openBtn = document.getElementById("ksOpenBtn");
    if (toggleBtn) toggleBtn.addEventListener("click", toggle);
    if (openBtn) openBtn.addEventListener("click", toggle);
    var logoutBtn = document.getElementById("ksLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        try { sessionStorage.removeItem(PW_KEY); } catch (e) {}
        location.reload();
      });
    }
  }

  if (isAuthed()) {
    renderSidebar();
    document.documentElement.style.visibility = "visible";
    return;
  }

  var realChildren = Array.prototype.slice.call(document.body.children);
  realChildren.forEach(function (el) {
    el.style.display = "none";
  });

  var gate = document.createElement("div");
  gate.id = "kvkAuthGate";
  gate.style.cssText =
    "max-width:360px;margin:80px auto;padding:24px;background:#fff;border-radius:12px;" +
    "box-shadow:0 1px 4px rgba(0,0,0,0.08);font-family:'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;";
  gate.innerHTML =
    '<h2 style="font-size:17px;margin:0 0 10px;">🔒 管理者ログイン</h2>' +
    '<div style="font-size:13px;color:#666;margin-bottom:12px;">KvK相手突合せを見るにはパスワードを入力してください。</div>' +
    '<input type="password" id="kvkGatePw" placeholder="パスワード" autocomplete="current-password" ' +
    'style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:14px;margin-bottom:10px;box-sizing:border-box;">' +
    '<button type="button" id="kvkGateBtn" style="width:100%;padding:9px;background:#4a6cf7;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">ログイン</button>' +
    '<div id="kvkGateMsg" style="font-size:13px;margin-top:8px;min-height:1em;"></div>';
  document.body.appendChild(gate);
  document.documentElement.style.visibility = "visible";

  function tryLogin() {
    var pwEl = document.getElementById("kvkGatePw");
    var pw = pwEl.value;
    if (!pw) return;
    var btn = document.getElementById("kvkGateBtn");
    var msg = document.getElementById("kvkGateMsg");
    btn.disabled = true;
    msg.style.color = "#666";
    msg.textContent = "確認中…";
    fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "get", password: pw }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (res.ok) {
          try {
            sessionStorage.setItem(PW_KEY, pw);
          } catch (e) {}
          gate.remove();
          realChildren.forEach(function (el) {
            el.style.display = "";
          });
          renderSidebar();
        } else if (res.status === 401) {
          msg.style.color = "#d9435e";
          msg.textContent = "パスワードが違います";
          pwEl.select();
        } else {
          msg.style.color = "#d9435e";
          msg.textContent = "確認できませんでした（" + (res.error || res.status) + "）";
        }
      })
      .catch(function () {
        msg.style.color = "#d9435e";
        msg.textContent = "接続できませんでした。時間をおいてもう一度試してください";
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  document.getElementById("kvkGateBtn").addEventListener("click", tryLogin);
  document.getElementById("kvkGatePw").addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryLogin();
  });
  document.getElementById("kvkGatePw").focus();
})();
