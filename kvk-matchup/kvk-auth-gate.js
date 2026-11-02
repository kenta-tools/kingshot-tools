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

  if (isAuthed()) {
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
