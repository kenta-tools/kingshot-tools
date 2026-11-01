/**
 * メンバー管理（admin/members-admin.html）の保存用 中継役（Google Apps Script ウェブアプリ）。
 *
 * GitHub のトークンをここ（スクリプトプロパティ）にだけ置き、管理画面からは
 * パスワード付きで「取得（get）」「保存（put）」を頼む。更新できるのは data/members.json だけ。
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   GITHUB_TOKEN  : kenta-tools の Fine-grained トークン（kingshot-tools のみ・Contents: Read and write）
 *   EDIT_PASSWORD : 管理画面のログインパスワードと同じ文字列
 *
 * デプロイ: デプロイ → 新しいデプロイ → 種類「ウェブアプリ」→ 実行ユーザー「自分」→ アクセス「全員」
 */
var GH = { owner: "kenta-tools", repo: "kingshot-tools", path: "data/members.json", branch: "main" };
var MAX_BYTES = 900 * 1024; // GitHub Contents API の上限（1MB）より少し小さく

function doPost(e) {
  var p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, status: 400, error: "リクエストが読めません" });
  }
  return handle_(p);
}

function doGet() {
  return json_({ ok: true, message: "members proxy is running" });
}

function handle_(p) {
  try {
    var props = PropertiesService.getScriptProperties();
    var password = props.getProperty("EDIT_PASSWORD");
    var token = props.getProperty("GITHUB_TOKEN");
    if (!password || !token) return json_({ ok: false, status: 500, error: "中継役の設定（スクリプトプロパティ）が未完了です" });
    if (p.password !== password) {
      Utilities.sleep(1000); // 総当たり対策
      return json_({ ok: false, status: 401, error: "パスワードが違います" });
    }

    var url = "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path;
    var headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };

    if (p.action === "get") {
      var r = UrlFetchApp.fetch(url + "?ref=" + GH.branch, { headers: headers, muteHttpExceptions: true });
      var code = r.getResponseCode();
      if (code === 404) return json_({ ok: true, content: null, sha: null });
      if (code !== 200) return json_({ ok: false, status: code, error: "GitHubから取得できませんでした" });
      var j = JSON.parse(r.getContentText());
      return json_({ ok: true, content: j.content, sha: j.sha });
    }

    if (p.action === "put") {
      // members.json の形になっているかだけ確認してから保存する
      var bytes = Utilities.base64Decode(p.content || "");
      if (bytes.length > MAX_BYTES) return json_({ ok: false, status: 413, error: "データが大きすぎます" });
      var data = JSON.parse(Utilities.newBlob(bytes).getDataAsString("UTF-8"));
      if (!Array.isArray(data.users) || !Array.isArray(data.events) || !Array.isArray(data.entries)) {
        return json_({ ok: false, status: 400, error: "members.json の形式ではありません" });
      }
      var body = { message: "Update members.json from admin page", content: p.content, branch: GH.branch };
      if (p.sha) body.sha = p.sha;
      var r2 = UrlFetchApp.fetch(url, {
        method: "put", headers: headers, contentType: "application/json",
        payload: JSON.stringify(body), muteHttpExceptions: true
      });
      var c2 = r2.getResponseCode();
      if (c2 === 200 || c2 === 201) return json_({ ok: true });
      return json_({ ok: false, status: c2, error: "GitHubへの保存に失敗しました" });
    }

    return json_({ ok: false, status: 400, error: "不明な操作です" });
  } catch (err) {
    return json_({ ok: false, status: 500, error: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
