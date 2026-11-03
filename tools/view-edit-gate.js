// tools/配下のツールを「閲覧モード（既定）」と「編集可モード」に分ける。
// 編集可モードは管理画面と同じパスワード（中継役GASのEDIT_PASSWORDで確認）。
// 管理画面に既にログイン済みの同じタブなら、自動で編集可になる（sessionStorage ksAdminPw を流用）。
// ツール単体の「編集可」はこのタブ・このツールだけの状態として別キー（ksToolsEditPw）に持つので、
// ここをロックし直しても管理画面側のログインは消えない。
//
// 閲覧モード中の入力禁止はCSS（body.ve-view-mode配下のinput/select/textarea/buttonをpointer-events:none）
// で行う。周期ウェーブタイマーのように毎フレームDOMを再構築するツールでも、セレクタで効くので
// 要素ごとにdisabledを付け直す必要がない。
//
// 使い方：対応ページの</body>の直前に <script src="view-edit-gate.js"></script> を入れる。
(function () {
  "use strict";
  var ADMIN_PW_KEY = "ksAdminPw";
  var TOOLS_PW_KEY = "ksToolsEditPw";
  var GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec";

  var STYLE = [
    "body.ve-view-mode input, body.ve-view-mode select, body.ve-view-mode textarea, body.ve-view-mode button {",
    "  pointer-events: none !important;",
    "  opacity: 0.55;",
    "  filter: grayscale(30%);",
    "}",
    "body.ve-view-mode .ve-exempt,",
    "body.ve-view-mode #vePromptBox input, body.ve-view-mode #vePromptBox button,",
    "body.ve-view-mode .ks-sidebar input, body.ve-view-mode .ks-sidebar button,",
    "body.ve-view-mode .ve-badge input, body.ve-view-mode .ve-badge button {",
    "  pointer-events: auto !important;",
    "  opacity: 1 !important;",
    "  filter: none !important;",
    "}",
    ".ve-badge { position: fixed; bottom: 14px; right: 14px; z-index: 100000; font-family: 'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif; }",
    "#vePromptBox { position: fixed; inset: 0; z-index: 100001; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }",
  ].join("\n");

  function isEditable() {
    try {
      return !!(sessionStorage.getItem(ADMIN_PW_KEY) || sessionStorage.getItem(TOOLS_PW_KEY));
    } catch (e) {
      return false;
    }
  }

  function applyMode() {
    document.body.classList.toggle("ve-view-mode", !isEditable());
  }

  var badgeEl = null;

  function renderBadge() {
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.className = "ve-badge";
      document.body.appendChild(badgeEl);
    }
    if (isEditable()) {
      badgeEl.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; background:#fff; border:1px solid #cfe8d8; border-radius:999px; padding:7px 14px; box-shadow:0 2px 8px rgba(0,0,0,0.12); font-size:12px;">' +
        '<span style="color:#1e7d3a; font-weight:bold;">🔓 編集可モード</span>' +
        '<button type="button" class="ve-exempt" id="veLockBtn" style="font:inherit; font-size:11px; padding:3px 9px; border-radius:999px; border:1px solid #ccc; background:#f7f7f7; color:#555; cursor:pointer;">閲覧モードに戻す</button>' +
        "</div>";
      var lockBtn = document.getElementById("veLockBtn");
      if (lockBtn) {
        lockBtn.addEventListener("click", function () {
          try {
            sessionStorage.removeItem(TOOLS_PW_KEY);
          } catch (e) {}
          applyMode();
          renderBadge();
        });
      }
    } else {
      badgeEl.innerHTML =
        '<button type="button" class="ve-exempt" id="veUnlockBtn" style="display:flex; align-items:center; gap:6px; font:inherit; font-size:12px; padding:8px 16px; border-radius:999px; border:1px solid #ccc; background:#fff; color:#555; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.12);">🔒 閲覧モード（押して編集可に）</button>';
      var unlockBtn = document.getElementById("veUnlockBtn");
      if (unlockBtn) unlockBtn.addEventListener("click", showPrompt);
    }
  }

  function showPrompt() {
    if (document.getElementById("vePromptBox")) return;
    var box = document.createElement("div");
    box.id = "vePromptBox";
    box.innerHTML =
      '<div style="background:#fff; border-radius:12px; padding:22px; width:300px; max-width:90vw; box-shadow:0 4px 20px rgba(0,0,0,0.2); font-family:\'Segoe UI\',\'Hiragino Kaku Gothic ProN\',Meiryo,sans-serif;">' +
      '<div style="font-size:14px; font-weight:bold; margin-bottom:10px;">🔓 編集可モードにする</div>' +
      '<div style="font-size:12px; color:#666; margin-bottom:10px;">管理画面と同じパスワードを入力してください。</div>' +
      '<input type="password" class="ve-exempt" id="vePwInput" placeholder="パスワード" autocomplete="current-password" style="width:100%; padding:8px 10px; border:1px solid #ddd; border-radius:6px; font-size:14px; margin-bottom:10px; box-sizing:border-box;">' +
      '<div style="display:flex; gap:8px;">' +
      '<button type="button" class="ve-exempt" id="vePwOkBtn" style="flex:1; padding:9px; background:#4a6cf7; color:#fff; border:none; border-radius:8px; font-size:14px; cursor:pointer;">編集可にする</button>' +
      '<button type="button" class="ve-exempt" id="vePwCancelBtn" style="padding:9px 14px; background:#fff; color:#555; border:1px solid #ccc; border-radius:8px; font-size:14px; cursor:pointer;">キャンセル</button>' +
      "</div>" +
      '<div id="vePwMsg" style="font-size:12px; margin-top:8px; min-height:1em;"></div>' +
      "</div>";
    document.body.appendChild(box);
    var pwEl = document.getElementById("vePwInput");
    var msg = document.getElementById("vePwMsg");

    function close() {
      box.remove();
    }

    function tryUnlock() {
      var pw = pwEl.value;
      if (!pw) return;
      var okBtn = document.getElementById("vePwOkBtn");
      okBtn.disabled = true;
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
              sessionStorage.setItem(TOOLS_PW_KEY, pw);
            } catch (e) {}
            close();
            applyMode();
            renderBadge();
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
          okBtn.disabled = false;
        });
    }

    document.getElementById("vePwOkBtn").addEventListener("click", tryUnlock);
    document.getElementById("vePwCancelBtn").addEventListener("click", close);
    pwEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryUnlock();
    });
    pwEl.focus();
  }

  var styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  applyMode();
  renderBadge();
})();
