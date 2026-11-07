(function() {
  // ログインパスワードはこのページには持たず、中継役（GAS のスクリプトプロパティ EDIT_PASSWORD）で確認する。
  // ソースを見てもパスワードの手がかりはなく、保存も中継役が毎回パスワードを確認する。
  var PW_KEY = "ksAdminPw";
  var PW_SAVED_KEY = "ksAdminPwSaved"; // 「パスワードを保存する」にチェックしてログインしたときだけ使う（タブを閉じても残る）
  try { if (!sessionStorage.getItem(PW_KEY) && localStorage.getItem(PW_SAVED_KEY)) sessionStorage.setItem(PW_KEY, localStorage.getItem(PW_SAVED_KEY)); } catch (e) {}
  var DRAFT_KEY = "ksMembersDraftV2";
  var EVENT_KEY = "ksAdminEvent";

  var EVENT_TYPES = ["KVK", "聖剣", "聖剣リーグ", "三盟", "炎龍", "遺跡争奪"];
  // 遺跡争奪：参加は「時間ごと」に yes＝参加／maybe＝行けるかも／no＝不参加（entries[].slots。中継役・entry/index.html の RUIN_SLOTS と同じ）
  var RUIN_TYPE = "遺跡争奪";
  var RUIN_SLOTS = ["12", "18", "22", "23", "25"];
  var SLOT_MARK = { yes: "◯", maybe: "△", no: "×" };
  function slotLabel(k) { return k + "時" + (k === "25" ? "（翌1時）" : ""); }
  // 時間帯ごとの対象（events[].ruinTargets。チーム分けで使う）。要塞→遺跡の番号順
  var RUIN_TARGETS = ["要塞1", "要塞2", "要塞3", "要塞4"].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function(n) { return "遺跡" + n; }));
  function normRuinTargets(src) {
    if (!src || typeof src !== "object") return undefined;
    var out = {};
    RUIN_SLOTS.forEach(function(k) {
      var list = Array.isArray(src[k]) ? src[k] : [];
      out[k] = RUIN_TARGETS.filter(function(t) { return list.indexOf(t) >= 0; });
    });
    return out;
  }
  // 対象（要塞・遺跡）のある時間だけ（登録ページ entry/ の ruinTimes と同じ。対象が1つもなければ5つ全部）
  function ruinTimes(id) {
    var ev = eventById(id || currentEventId), t = (ev && ev.ruinTargets) || {};
    var keys = RUIN_SLOTS.filter(function(k) { return (t[k] || []).length; });
    return keys.length ? keys : RUIN_SLOTS;
  }
  function isRuinEvent(id) { var ev = eventById(id); return !!ev && ev.type === RUIN_TYPE; }
  // 中継役の cleanEntry_ と同じ：決まった時間のキーで yes/maybe/no の値だけ残す。1つも無ければ undefined（保存しない）
  function normSlots(src) {
    if (!src || typeof src !== "object") return undefined;
    var out = {}, any = false;
    RUIN_SLOTS.forEach(function(k) { if (["yes", "maybe", "no"].indexOf(src[k]) >= 0) { out[k] = src[k]; any = true; } });
    return any ? out : undefined;
  }
  var GRADES = ["G8", "G7", "G6", "G5", "その他"];
  var ENTRY_LABEL = { start: "最初から参加できる", late: "途中参加", absent: "不参加" };
  var ENTRY_SHORT = { start: "最初から", late: "途中参加", absent: "不参加" };
  var ENTRY_ORDER = ["start", "late", "absent"];
  var TROOP_ORDER = "歩騎弓";
  // ペットLvの最大（0＝持っていない）。これを超える値は読み込み・入力時に空欄にする
  var PET_MAX = { marchPet: 10, rallyPet: 10, rallySpeedPet: 8 };
  // 数値の登録項目（出征＝全員、集結＝指示があった人だけ）
  var NUM_FIELDS = [
    ["marchCount", "出征部隊数"], ["marchPet", "出征容量ペットLv"],
    ["rallyCount", "集結部隊数"], ["rallyPet", "集結容量ペットLv"], ["rallySpeedPet", "行軍速度ペットLv"]
  ];
  var LEGEND = "◯:マンスリー持ち\n△:途中抜け\n◇:VC参加可能(聴き専可)\n◆:ビビアン星4以上持ち";
  var SAMPLE = [
    "EGG(最初から参加できる)", LEGEND,
    "G8:", "G7: あんこ◯△◆(〜22時)(T11)、", "G6: おもち◯◇(歩弓T11)、", "G5:ささき◯、", "その他:", "",
    "EGG(途中参加)", LEGEND,
    "G8:", "G7: かけ◯◇(23時〜)(歩弓)、", "G6: ", "G5:", "その他:"
  ].join("\n");
  var BLANK = ["同盟名:", LEGEND, "G8:", "G7:", "G6:", "G5:", "その他:"].join("\n");
  var FENCE = "```";
  // 別人リストの各組（「- 名前A と 名前B」）
  function notSameLines() {
    return state.notSame.map(function(p) {
      var ids = p.split("|"), a = userById(ids[0]), b = userById(ids[1]);
      return a && b ? "- " + a.name + " と " + b.name : "";
    }).filter(Boolean);
  }

  // AI変換用プロンプト。選択中のイベント名と登録済みユーザー一覧を埋め込むので、イベント・ユーザーが変わるたびに作り直す
  function buildPrompt() {
    var ev = eventById(currentEventId);
    var userLines = state.users.slice().sort(function(a, b) { return a.name.localeCompare(b.name, "ja"); }).map(function(u) {
      return "- " + u.name + "（" + (u.alliance || "同盟なし") + "）" + (u.aliases.length ? " 旧名・別表記: " + u.aliases.join("、") : "");
    });
    return [
      "これから、イベント「" + eventLabel(ev) + "」の参加者の「募集フォーマット」の記入内容を、同盟ごとなど何回かに分けて送ります。",
      "",
      "## 進め方",
      "- このメッセージへの返事は「準備OK（" + eventLabel(ev) + "）」の一言だけにしてください（まだ変換しないでください）",
      "- 記入内容が送られてくるたびに、下の変換ルールで読み取って覚えておき、返事は「受け取りました：同盟名 ◯人（累計 ◯人）」の1行だけにしてください（JSONはまだ出さない）",
      "- 「まとめて出力」と送られたら、JSONを出す前に「同一人物の確認」をしてください（下記）。確認が必要な人がいなければ、すぐにJSONを出力してください",
      "- 確認が終わったら、それまでに受け取った全員分を1つのJSON配列にまとめて出力してください",
      "- まとめるとき、同じ同盟の同じ名前の人が複数回出てきたら、後から送られた内容を採用して1人にしてください",
      "- 名前の一部か印か判断できないなど迷った点があれば、JSONの下に箇条書きで書いてください",
      "",
      "## 同一人物の確認",
      "- 受け取った名前を、一番下の「登録済みユーザー一覧」（名前・旧名）と見比べてください",
      "- 一覧の名前・旧名と完全に同じなら確認不要です（sameAs は \"\"）",
      "- 完全には同じでないが同一人物かもしれない人（表記ゆれ・全角半角・大文字小文字・カタカナひらがな・1〜2文字違い・記号の有無・改名っぽい名前など）がいたら、番号付きで一覧にして「同一人物ですか？ 番号ごとに はい／いいえ で答えてください」と私に質問してください",
      "  例: 1. 送られた「R35o」（TNP） ⇔ 登録済み「R35」（TNP）",
      "- 今回送られた中に、同じ人が別の名前で2回いそうな場合も同じように質問してください（同一なら後から送られた内容で1人にまとめる）",
      "- 私が「はい」と答えた人は、sameAs に登録済み一覧の名前をそのまま書いてください。「いいえ」の人や確認しなかった人は sameAs を \"\" にしてください",
      "",
      "## 変換ルール",
      "- 1人＝1オブジェクト。出力はJSON配列を " + FENCE + "json のコードブロックで出す",
      "- alliance: 同盟名（見出しの「同盟名:TNP」「EGG(最初から参加できる)」などから取る）",
      "- entry: 見出しが「途中参加」なら \"途中参加\"、それ以外は \"最初から\"",
      "- grade: そのメンバーが書かれている区分 \"G8\" \"G7\" \"G6\" \"G5\" \"その他\" のどれか。「G8:」の次の行から1人ずつ書かれている場合も、次の区分が出てくるまでは同じ区分",
      "- name: 今回送られてきたプレイヤー名だけ（印・括弧・時間・兵種は含めない）",
      "- sameAs: 同一人物の確認で「はい」になった登録済みユーザーの名前。それ以外は \"\"",
      "- 記号は、見た目が近ければ書き方（全角半角・大きさ・絵文字・白黒）が違っても同じ記号とみなす。ただし ◇（白ひし形）と ◆（黒ひし形）は別の印なので区別する",
      "- monthly: ◯ があれば true（〇・○・◯・⭕・●・⚪・o・O・ｏ・Ｏ など丸っぽい文字も ◯ とみなす）",
      "- leaveEarly: △ があれば true（▲・▵・∆・Δ なども △ とみなす）。抜ける時刻が書いてあれば true",
      "- vc: ◇ があれば true（⋄・♢ なども ◇ とみなす）",
      "- vivian4: ◆ があれば true（♦・⬥・🔶・🔷 なども ◆ とみなす）",
      "- troops: 兵種。歩兵=歩、騎兵=騎、弓兵=弓 を「歩騎弓」の順につなげる（例 \"歩弓\"）。「T11」だけで兵種の指定がなければ \"歩騎弓\"。兵種もTもなければ \"\"",
      "- tier: 兵士レベルの数字（T11 → 11）。なければ null",
      "- joinAt: 参加開始時刻（「23時〜」→ \"23時\"）。なければ \"\"",
      "- leaveAt: 抜ける時刻（「〜22時」→ \"22時\"）。なければ \"\"",
      "- note: 上のどれにも当てはまらない補足。なければ \"\"",
      "- 名前の直後の o・〇 は名前の一部ではなく ◯ 印として扱う。名前の一部か印か判断できないときは note に「要確認: 〜」と書く",
      "- 括弧の全角・半角、〜・～・~ の違いは同じものとして扱う。兵種・Tは括弧の外に書かれていても読み取る",
      "- 挨拶文や凡例の行（「◯:マンスリー持ち」など）は無視する",
      "",
      "## 例（「まとめて出力」したときの形）",
      "受け取った内容:",
      "EGG(最初から参加できる)",
      "G7: あんこ◯△◆(〜22時)(T11)、",
      "G6: おもち◯◇(歩弓T11)、",
      "EGG(途中参加)",
      "G7: かけ◯◇(23時〜)(歩弓)、",
      "（登録済み一覧に「あんこ」がいて、「おもち」は登録済み「お餅」と同一人物か質問して「はい」と回答された場合）",
      "",
      "出力:",
      FENCE + "json",
      "[",
      "  {\"alliance\":\"EGG\",\"entry\":\"最初から\",\"grade\":\"G7\",\"name\":\"あんこ\",\"sameAs\":\"\",\"monthly\":true,\"leaveEarly\":true,\"vc\":false,\"vivian4\":true,\"troops\":\"歩騎弓\",\"tier\":11,\"joinAt\":\"\",\"leaveAt\":\"22時\",\"note\":\"\"},",
      "  {\"alliance\":\"EGG\",\"entry\":\"最初から\",\"grade\":\"G6\",\"name\":\"おもち\",\"sameAs\":\"お餅\",\"monthly\":true,\"leaveEarly\":false,\"vc\":true,\"vivian4\":false,\"troops\":\"歩弓\",\"tier\":11,\"joinAt\":\"\",\"leaveAt\":\"\",\"note\":\"\"},",
      "  {\"alliance\":\"EGG\",\"entry\":\"途中参加\",\"grade\":\"G7\",\"name\":\"かけ\",\"sameAs\":\"\",\"monthly\":true,\"leaveEarly\":false,\"vc\":true,\"vivian4\":false,\"troops\":\"歩弓\",\"tier\":null,\"joinAt\":\"23時\",\"leaveAt\":\"\",\"note\":\"\"}",
      "]",
      FENCE,
      "",
      "## 登録済みユーザー一覧（" + state.users.length + "人）",
      userLines.length ? userLines.join("\n") : "（まだいません。同一人物の確認は、今回送られた中での重複だけ行ってください）"
    ].concat(notSameLines().length ? [
      "",
      "## 別人と確認済みの組（似ていても別人です。同一人物か質問しないでください）",
      notSameLines().join("\n")
    ] : []).join("\n");
  }

  var $ = function(id) { return document.getElementById(id); };
  // ページによって存在しない要素もあるので、addEventListenerはこのヘルパー経由にして安全にする
  function on(id, evt, fn) { var el = $(id); if (el) el.addEventListener(evt, fn); }

  // ---------- 左サイドバー（tools/の左サイドバーと同じ見た目。ログイン後にだけ差し込む） ----------
  var ADMIN_NAV = [
    ["events.html", "📅", "イベント"],
    ["participants.html", "👥", "参加者一覧"],
    ["teams.html", "🧩", "チーム分け"],
    ["users.html", "🗂️", "ユーザー管理"],
    ["logs.html", "🕵️", "個人登録の記録"],
    ["inquiries.html", "📨", "問い合わせ・質問"],
  ];
  var ADMIN_SIDEBAR_CSS = [
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
    "body.ks-collapsed .ks-sidebar .ks-group { margin: 6px 0; }",
    ".ks-open-btn { display: none; position: fixed; top: 14px; left: 14px; z-index: 100001; width: 34px; height: 34px; border-radius: 8px; border: none; background: #1a2332; color: #fff; font-size: 16px; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }",
    "body.has-admin-sidebar { margin-left: 240px !important; transition: margin-left 0.2s ease; }",
    "body.has-admin-sidebar.ks-collapsed { margin-left: 76px !important; }",
    "body.ks-collapsed .ks-sidebar { width: 56px; padding-left: 8px; padding-right: 8px; }",
    "body.ks-collapsed .ks-sidebar .ks-title { display: none; }",
    "body.ks-collapsed .ks-title-row { justify-content: center; }",
    "body.ks-collapsed .ks-sidebar .ks-label { display: none; }",
    "body.ks-collapsed .ks-sidebar .ks-link { justify-content: center; padding: 8px 0; }",
    ".ks-menu-btn { display: none; }",
    "@media (max-width: 760px) {",
    "  .ks-sidebar, body.ks-collapsed .ks-sidebar { width: 100% !important; height: 48px; padding: 0 12px !important; overflow: visible; }",
    "  .ks-title-row, body.ks-collapsed .ks-title-row { height: 48px; margin-bottom: 0; justify-content: flex-start; }",
    "  .ks-sidebar .ks-title, body.ks-collapsed .ks-sidebar .ks-title { display: block; font-size: 14px; }",
    "  .ks-toggle-btn, .ks-open-btn, body.ks-collapsed .ks-open-btn { display: none !important; }",
    "  .ks-menu-btn { display: flex; margin-left: auto; flex: 0 0 auto; width: 40px; height: 34px; border-radius: 6px; border: 1px solid #3a4a63; background: transparent; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; align-items: center; justify-content: center; }",
    "  .ks-sidebar nav { display: none; position: absolute; top: 48px; left: 0; right: 0; max-height: calc(100vh - 48px); overflow-y: auto; background: #1a2332; padding: 6px 10px 12px; box-sizing: border-box; box-shadow: 0 8px 18px rgba(0,0,0,0.35); }",
    "  body.ks-menu-open .ks-sidebar nav { display: flex; }",
    "  .ks-sidebar .ks-link, body.ks-collapsed .ks-sidebar .ks-link { justify-content: flex-start; padding: 10px; font-size: 14px; }",
    "  .ks-sidebar .ks-label, body.ks-collapsed .ks-sidebar .ks-label { display: inline; }",
    "  .ks-sidebar .ks-group, body.ks-collapsed .ks-sidebar .ks-group { display: block; margin: 10px 4px; }",
    "  body.has-admin-sidebar, body.has-admin-sidebar.ks-collapsed { margin-left: 0 !important; padding-top: 56px !important; }",
    "}",
  ].join("\n");

  // スマホ幅のメニュー：☰で開閉。開いているときにメニューの外をタップしたら閉じ、そのタップは下の画面に通さない
  function bindMobileMenu() {
    if (window.__ksMenuBound) return;
    window.__ksMenuBound = true;
    function setMenuOpen(open) {
      document.body.classList.toggle("ks-menu-open", open);
      document.querySelectorAll(".ks-menu-btn").forEach(function(b) {
        b.textContent = open ? "✕" : "☰";
        b.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    function outsideMenu(t) {
      return document.body.classList.contains("ks-menu-open") && !(t.closest && (t.closest(".ks-sidebar nav") || t.closest(".ks-menu-btn")));
    }
    window.addEventListener("mousedown", function(e) { if (outsideMenu(e.target)) e.preventDefault(); }, true);
    window.addEventListener("click", function(e) {
      if (e.target.closest && e.target.closest(".ks-menu-btn")) { setMenuOpen(!document.body.classList.contains("ks-menu-open")); return; }
      if (outsideMenu(e.target)) { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); }
    }, true);
  }

  function renderAdminSidebar() {
    if ($("ksAdminSidebar")) return; // 二重挿入防止
    var here = location.pathname.split("/").pop();
    var links = ADMIN_NAV.map(function(item) {
      var active = item[0] === here;
      return '<a href="' + item[0] + '" class="ks-link' + (active ? " ks-active" : "") + '" title="' + item[2] + '">' +
        '<span class="ks-icon">' + item[1] + '</span><span class="ks-label">' + item[2] + "</span></a>";
    }).join("");

    var style = document.createElement("style");
    style.textContent = ADMIN_SIDEBAR_CSS;
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="ks-sidebar" id="ksAdminSidebar">' +
        '<div class="ks-title-row"><span class="ks-title">🔐 管理画面</span>' +
          '<button type="button" class="ks-toggle-btn" id="ksToggleBtn">←</button>' +
          '<button type="button" class="ks-menu-btn" aria-label="メニュー" aria-expanded="false">☰</button></div>' +
        "<nav>" + links +
          '<div class="ks-group"></div>' +
          '<a href="../kvk-matchup/kvk-matchup-index.html" class="ks-link" title="KvK相手突合せ"><span class="ks-icon">⚔️</span><span class="ks-label">KvK相手突合せ</span></a>' +
          '<a href="../index.html" class="ks-link" title="TOP"><span class="ks-icon">🏠</span><span class="ks-label">TOP</span></a>' +
          '<button type="button" class="ks-link" id="logoutBtn" title="ログアウト"><span class="ks-icon">🚪</span><span class="ks-label">ログアウト</span></button>' +
        "</nav>" +
      "</div>" +
      '<button type="button" class="ks-open-btn" id="ksOpenBtn" aria-label="メニューを開く">☰</button>';
    while (wrap.firstChild) $("appView").insertBefore(wrap.firstChild, $("appView").firstChild);
    document.body.classList.add("has-admin-sidebar");

    var collapsed = false;
    try { collapsed = localStorage.getItem("ksAdminSidebarCollapsed") === "1"; } catch (e) {}
    function applyBtn() {
      var btn = $("ksToggleBtn");
      if (btn) btn.textContent = document.body.classList.contains("ks-collapsed") ? "→" : "←";
    }
    if (collapsed) document.body.classList.add("ks-collapsed");
    applyBtn();
    bindMobileMenu();
    function toggle() {
      var next = !document.body.classList.contains("ks-collapsed");
      document.body.classList.toggle("ks-collapsed", next);
      try { localStorage.setItem("ksAdminSidebarCollapsed", next ? "1" : "0"); } catch (e) {}
      applyBtn();
    }
    on("ksToggleBtn", "click", toggle);
    on("ksOpenBtn", "click", toggle);
  }

  // ---------- 認証 ----------
  // ログイン済み = このタブに中継役で確認済みのパスワードがある（保存時に中継役が毎回確認し直す）
  function isAuthed() {
    try { return !!sessionStorage.getItem(PW_KEY); } catch (e) { return false; }
  }

  function showApp() {
    $("loginView").style.display = "none";
    $("appView").style.display = "block";
    renderAdminSidebar();
    loadData();
  }

  // 中継役に「取得」を頼み、パスワードが正しければ成功する（間違いは中継役が1秒待たせるので総当たりしにくい）
  function tryLogin() {
    var pw = $("pwInput").value;
    if (!pw) return;
    $("loginBtn").disabled = true;
    $("loginMsg").textContent = "確認中…";
    fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "get", password: pw }) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok) {
          try { sessionStorage.setItem(PW_KEY, pw); if (document.getElementById("pwRemember").checked) localStorage.setItem(PW_SAVED_KEY, pw); else localStorage.removeItem(PW_SAVED_KEY); } catch (e) {} // 保存しない場合はこのタブを閉じると消える
          $("loginMsg").textContent = "";
          showApp();
        } else if (res.status === 401) {
          $("loginMsg").textContent = "パスワードが違います";
          $("pwInput").select();
        } else {
          $("loginMsg").textContent = "確認できませんでした（" + (res.error || res.status) + "）";
        }
      })
      .catch(function() {
        $("loginMsg").textContent = "接続できませんでした。時間をおいてもう一度試してください";
      })
      .then(function() { $("loginBtn").disabled = false; });
  }

  if ($("loginBtn") && !$("pwRemember")) $("loginBtn").insertAdjacentHTML("beforebegin", '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;margin:0 0 10px;cursor:pointer;"><input type="checkbox" id="pwRemember" style="width:auto;margin:0;"> パスワードを保存する（次回から入力不要。共用の端末ではチェックしない）</label>');
  on("loginBtn", "click", tryLogin);
  on("pwInput", "keydown", function(e) { if (e.key === "Enter") tryLogin(); });
  on("logoutBtn", "click", function() {
    try { sessionStorage.removeItem(PW_KEY); sessionStorage.removeItem("ksAdminAuth"); localStorage.removeItem(PW_SAVED_KEY); } catch (e) {}
    location.reload();
  });

  // ---------- データ ----------
  // state.users   : 蓄積されるユーザー { id, name, alliance (最新), aliases: 旧名・別表記 }。名前か旧名で同一人物を判定
  // state.notSame : 「別人」と判断した似た名前の組 "userId|userId"（候補に再表示しない）
  // state.events  : イベント { id, type: EVENT_TYPES のどれか, date: "YYYY-MM-DD" }
  // state.entries : イベントごとの参加情報 { id, eventId, userId, alliance (その時点), entry: "start"|"late",
  //                 grade: "G8".."G5"|"その他", monthly, leaveEarly, vc, vivian4 (各bool),
  //                 troops: "歩騎弓"の部分文字列 ("" = 指定なし), tier: 数値|null, joinAt, leaveAt (例 "23時"), note }
  var state = { users: [], events: [], entries: [], notSame: [] };
  var lastSaved = null;  // 最後に保存された日時（members.json の updated）
  var lastParsed = null; // 「読み取り結果を確認」で表示中の内容 { text, parsed }
  var loadedFile = null; // 読み込んだファイル { name, text }
  var currentEventId = null;
  var publishedJson = "";
  var editingId = null;
  var sortKey = null, sortDir = 1;
  var userSortKey = "name", userSortDir = 1;

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nameKey(name) {
    return String(name).trim().toLowerCase();
  }

  function normTroops(s) {
    s = String(s || "");
    return TROOP_ORDER.split("").filter(function(t) { return s.indexOf(t) >= 0; }).join("");
  }

  function str(v) { return String(v == null ? "" : v).trim(); }
  function bool(v) { return v === true || v === 1 || /^(1|true|◯|○|〇|yes|y)$/i.test(str(v)); }
  function num(v) {
    var s = str(v).replace(/[,，]/g, "").replace(/^(Lv|LV|lv)\.?/, "");
    return s && !isNaN(Number(s)) && Number(s) >= 0 ? Math.floor(Number(s)) : null;
  }
  function petLv(v, key) {
    var n = num(v);
    return n != null && n <= PET_MAX[key] ? n : null;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // 取り込み・フォーム・保存データ共通の参加情報の正規化（name は取り込み時のみ使う）
  function normalizeRow(m) {
    var tier = str(m.tier).replace(/^T/i, "");
    var grade = str(m.grade).toUpperCase().replace(/\s/g, "");
    return withCap(fitPartial({
      alliance: str(m.alliance),
      entry: m.entry === "absent" || /不参加/.test(str(m.entry)) ? "absent"
        : m.entry === "late" || /途中/.test(str(m.entry)) ? "late" : "start",
      grade: GRADES.indexOf(grade) >= 0 ? grade : "その他",
      name: str(m.name),
      monthly: bool(m.monthly),
      leaveEarly: bool(m.leaveEarly),
      vc: bool(m.vc),
      vivian4: bool(m.vivian4),
      mayChange: bool(m.mayChange), // 個人登録で「変更の可能性あり」
      troops: normTroops(m.troops),
      tier: tier && !isNaN(Number(tier)) ? Number(tier) : null,
      joinAt: str(m.joinAt),
      leaveAt: str(m.leaveAt),
      note: str(m.note),
      marchCount: num(m.marchCount),
      marchPet: petLv(m.marchPet, "marchPet"),
      rallyCount: num(m.rallyCount),
      rallyPet: petLv(m.rallyPet, "rallyPet"),
      rallySpeedPet: petLv(m.rallySpeedPet, "rallySpeedPet"),
      updatedAt: str(m.updatedAt), // 最後に登録・変更した日時（ISO）
      proxyBy: str(m.proxyBy), // 個人登録ページで代理入力した人の名前（本人の入力なら ""）
      sameAs: str(m.sameAs), // AI変換で登録者が「同一人物」と確認した登録済みユーザー名（取り込み時のみ使う）
      slots: normSlots(m.slots) // 遺跡争奪の時間ごとの参加（それ以外のイベントでは無し）
    }));
  }

  // 計算後の容量（marchCap / rallyCap）を部隊数・ペットLvから付け直す
  function withCap(r) {
    var c = calcCapacity(r);
    r.marchCap = c.march;
    r.rallyCap = c.rally;
    return r;
  }

  // 個人登録ページの「全部参加／一部参加／不参加」とそろえる（管理画面からの取り込み・入力は △ と途中参加のまま来るため）
  //   抜ける時刻あり → △（途中抜け）、参加開始の時刻あり → 途中参加、不参加 → 時刻と△は消す
  //   （△・途中参加で時刻がないものは、個人登録ページでは「一部参加」で時刻を入れてもらう）
  function fitPartial(r) {
    if (r.entry === "absent") {
      r.joinAt = "";
      r.leaveAt = "";
      r.leaveEarly = false;
      return r;
    }
    if (r.leaveAt) r.leaveEarly = true;
    if (r.joinAt) r.entry = "late";
    return r;
  }

  function normalize(list) {
    return (list || []).map(function(m) {
      var r = normalizeRow(m);
      r._given = givenKeys(m);
      return r;
    }).filter(function(m) { return m.name && m.alliance; });
  }

  // 取り込み元（JSON・CSV・募集フォーマット）に値が入っていた項目。null・空欄・項目なしは「入っていない」扱い
  function givenKeys(m) {
    var given = {};
    Object.keys(m || {}).forEach(function(k) {
      if (m[k] != null && str(m[k]) !== "") given[k] = true;
    });
    return given;
  }

  // 取り込みで既にいる人を更新するとき、取り込み元に入っていなかった項目は今の値を残す
  // （例：参加可否だけのJSONを取り込んでも、出征部隊数・ペットLvなどは消さない）
  var KEEP_ALWAYS = ["id", "eventId", "userId", "updatedAt", "marchCap", "rallyCap"];
  function mergeImported(row, prev) {
    if (!prev || !row._given) return row;
    var out = Object.assign({}, row);
    Object.keys(prev).forEach(function(k) {
      if (KEEP_ALWAYS.indexOf(k) >= 0) return;
      if (!row._given[k]) out[k] = prev[k];
    });
    if (row._given.slots && prev.slots && out.slots) out.slots = Object.assign({}, prev.slots, out.slots); // 遺跡争奪：書かれていない時間の回答は残す
    return fitPartial(out);
  }

  function normalizeState(data) {
    data = data || {};
    var users = (data.users || []).map(function(u) {
      return { id: u.id || newId("u"), name: str(u.name), alliance: str(u.alliance),
        aliases: (u.aliases || []).map(str).filter(Boolean),
        // 名前の履歴: 以前の名前と、いつまでその名前だったか（改名・統合のたびに追加）
        nameHistory: (u.nameHistory || []).map(function(h) { return { name: str(h.name), until: str(h.until) }; })
          .filter(function(h) { return h.name; }) };
    }).filter(function(u) { return u.name; });
    var events = (data.events || []).map(function(e) {
      return { id: e.id || newId("e"), type: EVENT_TYPES.indexOf(e.type) >= 0 ? e.type : EVENT_TYPES[0], date: str(e.date),
        open: e.open === true, // open: 個人登録ページ（entry/）で受付中
        done: e.done === true, // done: 完了したイベント（イベント一覧から外し「完了したイベント」に出す）
        ruinTargets: normRuinTargets(e.ruinTargets) }; // 遺跡争奪だけ：時間帯ごとの対象（要塞・遺跡）
    });
    var userIds = {}, eventIds = {};
    users.forEach(function(u) { userIds[u.id] = true; });
    events.forEach(function(e) { eventIds[e.id] = true; });
    var entries = (data.entries || []).filter(function(e) {
      return userIds[e.userId] && eventIds[e.eventId];
    }).map(function(e) {
      var r = normalizeRow(e);
      delete r.name;
      delete r.sameAs;
      r.id = e.id || newId("r");
      r.eventId = e.eventId;
      r.userId = e.userId;
      return r;
    });
    var notSame = (data.notSame || []).filter(function(p) {
      var ids = String(p).split("|");
      return userIds[ids[0]] && userIds[ids[1]];
    });
    return { users: users, events: events, entries: entries, notSame: notSame };
  }

  function serialize() {
    return JSON.stringify(state);
  }

  // ---------- 保存 ----------
  // データは中継役（Google Apps Script: work/gas_members_proxy.gs）が非公開の Google ドライブのファイルに保存する。
  // 読み書きはログインパスワード付きで中継役に頼む（公開サイトにはデータを置かない）。
  // GAS_URL は config.js（このファイルを読み込むページで、このファイルより先に読み込む）で定義

  function adminPassword() {
    try { return sessionStorage.getItem(PW_KEY) || ""; } catch (e) { return ""; }
  }

  // 保存方法: "gas"=中継役 / ""=保存できない
  function saveMode() {
    return GAS_URL ? "gas" : "";
  }

  function gasCall(payload) {
    payload.password = adminPassword();
    // text/plain にして CORS のプリフライトを避ける（GAS ウェブアプリの決まりごと）
    return fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (!res.ok && res.status === 401) throw new Error("保存用のパスワードが合いません。ログアウトしてログインし直してください");
        return res;
      });
  }

  function ghError(status) {
    if (status === 409 || status === 422) return "他の人の保存と重なりました。もう一度「保存する」を押してください";
    return "保存先との通信でエラーが発生しました（" + status + "）。時間をおいてもう一度試し、続く場合はサイトの管理者に連絡してください";
  }

  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function utf8ToB64(text) {
    var bytes = new TextEncoder().encode(text), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // 保存されている最新のデータを取得（sha は保存のたびに変わる版番号。保存時の衝突検出に使う）
  function fetchRemote() {
    return gasCall({ action: "get" }).then(function(res) {
      if (!res.ok) throw new Error(res.error || ghError(res.status));
      return { data: res.content ? JSON.parse(b64ToUtf8(res.content) || "{}") : {}, sha: res.sha };
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function byId(list) {
    var m = {};
    list.forEach(function(x) { m[x.id] = x; });
    return m;
  }

  // base（自分が読み込んだ時点の公開版）からの自分の変更（local）を、最新の公開版（remote）に重ねる。
  // 他の人が保存した追加・変更は残し、自分が追加・変更・削除したものだけを反映する。
  function mergeIntoRemote(base, local, remote) {
    var out = clone(remote);
    var bU = byId(base.users), lU = byId(local.users);
    var bV = byId(base.events), lV = byId(local.events);
    var bE = byId(base.entries), lE = byId(local.entries);
    var userMap = {}, eventMap = {};

    // 自分が削除したもの
    base.users.forEach(function(u) {
      if (lU[u.id]) return;
      out.users = out.users.filter(function(x) { return x.id !== u.id; });
      out.entries = out.entries.filter(function(e) { return e.userId !== u.id; });
    });
    base.events.forEach(function(v) {
      if (lV[v.id]) return;
      out.events = out.events.filter(function(x) { return x.id !== v.id; });
      out.entries = out.entries.filter(function(e) { return e.eventId !== v.id; });
    });
    base.entries.forEach(function(e) {
      if (!lE[e.id]) out.entries = out.entries.filter(function(x) { return x.id !== e.id; });
    });

    // ユーザー: 自分が追加・変更したものを反映（他の人が同じ名前で追加済みならそのユーザーにまとめる）
    local.users.forEach(function(u) {
      var b = bU[u.id];
      var changed = !b || JSON.stringify(b) !== JSON.stringify(u);
      var o = out.users.find(function(x) { return x.id === u.id; });
      if (o) {
        if (changed) {
          o.name = u.name; o.alliance = u.alliance;
          u.aliases.forEach(function(a) { addAlias(o, a); });
          o.nameHistory = unionHistory(o.nameHistory, u.nameHistory);
        }
        userMap[u.id] = o.id;
        return;
      }
      if (b && !changed) return; // 他の人が削除・統合したユーザーで、自分は触っていない
      var key = nameKey(u.name);
      var same = out.users.find(function(x) {
        return nameKey(x.name) === key || (x.aliases || []).some(function(a) { return nameKey(a) === key; });
      });
      if (same) {
        if (u.alliance) same.alliance = u.alliance;
        u.aliases.forEach(function(a) { addAlias(same, a); });
        same.nameHistory = unionHistory(same.nameHistory, u.nameHistory);
        userMap[u.id] = same.id;
      } else {
        out.users.push(clone(u));
        userMap[u.id] = u.id;
      }
    });

    // イベント: 同じ種類・同じ開催日は同じイベントとしてまとめる
    local.events.forEach(function(v) {
      var o = out.events.find(function(x) { return x.id === v.id; })
        || (!bV[v.id] && out.events.find(function(x) { return x.type === v.type && x.date === v.date; }));
      if (o) {
        if (bV[v.id] && bV[v.id].open !== v.open) o.open = v.open; // 自分が受付中／締切を切り替えた
        if (bV[v.id] && bV[v.id].done !== v.done) o.done = v.done; // 自分が完了／進行中を切り替えた
        if (bV[v.id] && JSON.stringify(bV[v.id].ruinTargets) !== JSON.stringify(v.ruinTargets)) o.ruinTargets = clone(v.ruinTargets || null) || undefined; // 自分が遺跡争奪の対象を変えた
        eventMap[v.id] = o.id;
        return;
      }
      if (bV[v.id]) return; // 他の人が削除したイベント
      out.events.push(clone(v));
      eventMap[v.id] = v.id;
    });

    // 参加情報: 自分が追加・変更したものを反映（同じイベント・同じ人は自分の内容で上書き）
    local.entries.forEach(function(e) {
      var b = bE[e.id];
      if (b && JSON.stringify(b) === JSON.stringify(e)) return;
      var uid = userMap[e.userId], vid = eventMap[e.eventId];
      if (!uid || !vid) return;
      var c = clone(e);
      c.userId = uid;
      c.eventId = vid;
      out.entries = out.entries.filter(function(x) { return x.id !== c.id && !(x.eventId === vid && x.userId === uid); });
      out.entries.push(c);
    });

    // 「別人」の記録は追加分だけ反映
    // 自分が解除した「別人」の組は消す
    base.notSame.forEach(function(p) {
      if (local.notSame.indexOf(p) < 0) out.notSame = out.notSame.filter(function(x) { return x !== p; });
    });
    local.notSame.forEach(function(p) {
      if (base.notSame.indexOf(p) >= 0) return;
      var ids = p.split("|");
      var a = userMap[ids[0]], b = userMap[ids[1]];
      if (a && b && a !== b && out.notSame.indexOf(pairKey(a, b)) < 0) out.notSame.push(pairKey(a, b));
    });

    return normalizeState(out);
  }

  // 画面を開いたとき・「最新を読み込む」: 最新の公開版を取得し、自分の未公開の変更を重ねる
  function loadData() {
    var draft = null;
    try {
      localStorage.removeItem("ksMembersDraft"); // 旧形式（イベント分け前）の下書き
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch (e) {}
    try { currentEventId = localStorage.getItem(EVENT_KEY); } catch (e) {}

    return fetchRemote().catch(function(e) {
      // 読めなかったときは空で表示する（保存時は最新を読み直してまとめるので、他の人の登録が消えることはない）
      setMsg($("ghMsg"), "保存内容を読み込めませんでした（" + e.message + "）。「その他の操作・設定」→「他の人が保存した内容を読み込む」で読み直してください", false);
      return { data: {}, sha: null };
    }).then(function(res) {
      lastSaved = res.data && res.data.updated || null;
      var remote = normalizeState(res.data);
      publishedJson = JSON.stringify(remote);
      if (draft && draft.base && draft.state) {
        state = mergeIntoRemote(normalizeState(JSON.parse(draft.base)), normalizeState(draft.state), remote);
      } else {
        state = remote;
      }
      saveDraft();
      render();
    });
  }

  // 下書きは「読み込んだ時点の公開版（base）」と一緒に保存し、公開時のマージに使う
  function saveDraft() {
    try {
      if (serialize() === publishedJson) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: publishedJson, state: state }));
    } catch (e) {}
  }

  // members.json を保存。戻り値 { ok, status }
  function remotePut(contentB64, sha) {
    return gasCall({ action: "put", content: contentB64, sha: sha }).then(function(res) {
      return { ok: res.ok, status: res.ok ? 200 : (res.status || 500), error: res.error };
    });
  }

  function publish(isRetry) {
    if (!saveMode()) {
      $("ghDetails").open = true;
      setMsg($("ghMsg"), "保存先がまだ設定されていません。サイトの管理者に連絡してください", false);
      return Promise.resolve();
    }
    saving = true;
    renderState();
    setMsg($("ghMsg"), "保存中…", true);
    return fetchRemote().then(function(res) {
      var remote = normalizeState(res.data);
      var merged = mergeIntoRemote(normalizeState(JSON.parse(publishedJson)), state, remote);
      // この画面が扱わない項目（kvkRosters など他ツールの保存分）は最新の保存内容のまま残す
      var body = Object.assign({}, res.data, { updated: new Date().toISOString(), users: merged.users, events: merged.events,
        entries: merged.entries, notSame: merged.notSame });
      return remotePut(utf8ToB64(JSON.stringify(body, null, 2) + "\n"), res.sha).then(function(r) {
        if ((r.status === 409 || r.status === 422) && !isRetry) return publish(true); // 直前に他の人が保存した → 取り直してもう一度
        if (!r.ok) throw new Error(r.error && r.status >= 500 ? r.error : ghError(r.status));
        publishedJson = JSON.stringify(merged);
        state = merged;
        lastSaved = body.updated;
        if (editingId && !state.entries.some(function(x) { return x.id === editingId; })) resetForm(false);
        saveDraft();
        render();
        setMsg($("ghMsg"), "保存しました（他の人が保存した内容ともまとめてあります）。", true);
      });
    }).catch(function(e) {
      setMsg($("ghMsg"), "保存できませんでした: " + e.message, false);
      if (!saveCardVisible) alert("保存できませんでした: " + e.message);
    }).then(function() {
      saving = false;
      renderState();
    });
  }

  on("publishBtn", "click", function() { publish(false); });
  on("pullBtn", "click", function() {
    setMsg($("ghMsg"), "読み込み中…", true);
    loadData().then(function() {
      if (!/読み込めませんでした/.test($("ghMsg").textContent)) {
        setMsg($("ghMsg"), "他の人が保存した最新の内容を読み込みました（あなたの保存前の変更はそのまま残っています）", true);
      }
    });
  });
  try { localStorage.removeItem("ksGhToken"); } catch (e) {} // 以前の GitHub 直接保存用トークン（もう使わない）

  function commit() {
    saveDraft();
    render();
  }

  // ---------- ユーザー・参加情報の操作 ----------
  function userById(id) {
    return state.users.find(function(u) { return u.id === id; });
  }

  function userNames(u) {
    return [u.name].concat(u.aliases || []);
  }

  // 名前か旧名が一致するユーザー
  function findUserByName(name) {
    var key = nameKey(name);
    return state.users.find(function(u) { return nameKey(u.name) === key; })
      || state.users.find(function(u) {
        return (u.aliases || []).some(function(a) { return nameKey(a) === key; });
      });
  }

  function addAlias(u, name) {
    u.aliases = u.aliases || [];
    if (nameKey(name) === nameKey(u.name)) return;
    if (u.aliases.some(function(a) { return nameKey(a) === nameKey(name); })) return;
    u.aliases.push(name);
  }

  function addHistory(u, names) {
    var now = new Date().toISOString();
    u.nameHistory = (u.nameHistory || []).concat(names.map(function(n) { return { name: n, until: now }; }));
  }

  // 名前の履歴を重複なくまとめる（同時に保存した管理者どうしの分を合わせるとき）
  function unionHistory(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function(h) {
      var k = h.name + "|" + h.until;
      if (!seen[k]) { seen[k] = true; out.push({ name: h.name, until: h.until }); }
    });
    return out.sort(function(x, y) { return x.until.localeCompare(y.until); });
  }

  function renameUser(u, newName) {
    var old = u.name;
    if (nameKey(old) !== nameKey(newName)) addHistory(u, [old]);
    u.name = newName;
    u.aliases = (u.aliases || []).filter(function(a) { return nameKey(a) !== nameKey(newName); });
    addAlias(u, old);
  }

  // ---------- 似た名前の判定 ----------
  // 全角半角・大文字小文字・カタカナひらがな・記号や空白の違いを無視したキー
  function looseKey(s) {
    return String(s).normalize("NFKC").toLowerCase()
      .replace(/[ァ-ヶ]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[\s・.,_\-ー〜~'"!！?？。、☆★♪]/g, "");
  }

  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 似ている度合い（小さいほど似ている）。似ていなければ -1
  function similarity(a, b) {
    var x = looseKey(a), y = looseKey(b);
    if (!x || !y) return -1;
    if (x === y) return 0;
    var d = editDistance(x, y);
    var max = Math.max(x.length, y.length), min = Math.min(x.length, y.length);
    // 2文字以下の名前は1文字違いでも別人のことが多いので、表記ゆれ（上の x === y）だけを似た名前とする
    if (max > 2 && d <= (max <= 4 ? 1 : 2)) return d;
    if (min >= 2 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) return 3;
    return -1;
  }

  function userSimilarity(u, name) {
    var best = -1;
    userNames(u).forEach(function(n) {
      var s = similarity(n, name);
      if (s >= 0 && (best < 0 || s < best)) best = s;
    });
    return best;
  }

  // 完全一致しない名前に対して、似ている既存ユーザー（似ている順に最大3人）
  function similarUsers(name) {
    return state.users.map(function(u) { return { u: u, s: userSimilarity(u, name) }; })
      .filter(function(r) { return r.s >= 0; })
      .sort(function(a, b) { return a.s - b.s; })
      .slice(0, 3);
  }

  function pairKey(a, b) {
    return a < b ? a + "|" + b : b + "|" + a;
  }

  // 既存ユーザー同士で似た名前の組（「別人」にした組は除く）
  function similarPairs() {
    var pairs = [];
    for (var i = 0; i < state.users.length; i++) {
      for (var j = i + 1; j < state.users.length; j++) {
        var a = state.users[i], b = state.users[j];
        if (state.notSame.indexOf(pairKey(a.id, b.id)) >= 0) continue;
        var best = -1;
        userNames(a).forEach(function(n) {
          var s = userSimilarity(b, n);
          if (s >= 0 && (best < 0 || s < best)) best = s;
        });
        if (best >= 0) pairs.push({ a: a, b: b, s: best });
      }
    }
    return pairs.sort(function(x, y) { return x.s - y.s; });
  }

  function eventById(id) {
    return state.events.find(function(e) { return e.id === id; });
  }

  function eventLabel(ev) {
    return ev ? ev.type + " " + ev.date : "";
  }

  // 名前でユーザーを探し、いなければ追加する。同盟は最新の値に更新
  function ensureUser(name, alliance) {
    var user = findUserByName(name);
    if (user) {
      if (alliance) user.alliance = alliance;
      return { user: user, created: false };
    }
    user = { id: newId("u"), name: name, alliance: alliance, aliases: [], nameHistory: [] };
    state.users.push(user);
    return { user: user, created: true };
  }

  // 取り込み行のユーザーを決める。row.matchUserId があれば「同一人物」判定に従う
  function resolveUser(row) {
    var u = row.matchUserId && userById(row.matchUserId);
    if (!u) return ensureUser(row.name, row.alliance);
    if (nameKey(u.name) !== nameKey(row.name)) {
      if (row.renameUser) renameUser(u, row.name);
      else addAlias(u, row.name);
    }
    if (row.alliance) u.alliance = row.alliance;
    return { user: u, created: false };
  }

  function entryOf(eventId, userId) {
    return state.entries.find(function(x) { return x.eventId === eventId && x.userId === userId; });
  }

  function toEntry(row, userId, id) {
    var e = withCap(Object.assign({}, row));
    delete e.name;
    delete e.sameAs;
    delete e._given;
    e.id = id || newId("r");
    e.updatedAt = new Date().toISOString();
    e.eventId = currentEventId;
    e.userId = userId;
    return e;
  }

  // 現在のイベントに参加情報を登録（同じ人がいれば上書き）。戻り値: { result: "added"|"updated", newUser }
  // prevByUser: 「置き換え」で外す前の参加情報（userIdごと）。取り込みに入っていない項目はそこから残す
  function upsertEntry(row, prevByUser) {
    var u = resolveUser(row);
    var existing = entryOf(currentEventId, u.user.id);
    if (existing) {
      var merged = mergeImported(row, existing);
      if (!merged.slots && existing.slots) merged.slots = existing.slots; // フォームからの変更でも遺跡争奪の時間は消さない
      state.entries[state.entries.indexOf(existing)] = toEntry(merged, u.user.id, existing.id);
      return { result: "updated", newUser: u.created };
    }
    var prev = prevByUser && prevByUser[u.user.id];
    state.entries.push(toEntry(mergeImported(row, prev), u.user.id, prev && prev.id));
    return { result: "added", newUser: u.created };
  }

  // 現在のイベントの参加者（表示用に名前を付けたもの）
  function eventRows() {
    return state.entries.filter(function(e) { return e.eventId === currentEventId; }).map(function(e) {
      var u = userById(e.userId);
      return Object.assign({}, e, { name: u ? u.name : "?" });
    });
  }

  // from の参加記録を to に移して from を削除（同じイベントに両方いる場合は to を残す）
  function mergeUsers(from, to) {
    var moved = 0, dropped = 0;
    state.entries = state.entries.filter(function(e) {
      if (e.userId !== from.id) return true;
      if (entryOf(e.eventId, to.id)) { dropped++; return false; }
      e.userId = to.id;
      moved++;
      return true;
    });
    userNames(from).forEach(function(n) { addAlias(to, n); });
    to.nameHistory = unionHistory(to.nameHistory, from.nameHistory);
    addHistory(to, [from.name]);
    state.users = state.users.filter(function(u) { return u.id !== from.id; });
    state.notSame = state.notSame.filter(function(p) { return p.split("|").indexOf(from.id) < 0; });
    return { moved: moved, dropped: dropped };
  }

  // ---------- 表示用の整形 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function marksOf(m) {
    return (m.monthly ? "◯" : "") + (m.leaveEarly ? "△" : "") + (m.vc ? "◇" : "") + (m.vivian4 ? "◆" : "");
  }

  // 「T11」「歩弓T11」「歩弓」 — 3兵種すべて or 指定なし＋Tありは「T11」だけ
  function troopText(m) {
    var troops = m.troops === TROOP_ORDER ? "" : m.troops;
    if (m.tier != null) return troops + "T" + m.tier;
    return troops;
  }

  // 「23時〜」「〜22時」「21時〜23時」
  function timeText(m) {
    if (!m.joinAt && !m.leaveAt) return "";
    return (m.joinAt || "") + "〜" + (m.leaveAt || "");
  }

  // 「出征3部隊 Lv50／集結1部隊 Lv40」
  // ---------- 容量の計算（スキル・バフの組み合わせは「容量の計算」欄で選ぶ） ----------
  // 条件は固定（中継役 GAS の calcCap_ と同じ）: 出征スキル・集結スキルあり、バフ20%をスキルなしの出征容量にかけ、
  // 出征で増えた分（スキル＋バフ）はそのまま集結容量にも入る。結果は登録データの marchCap / rallyCap に保存する
  var CAP_BUFF = 0.2;
  var CAP_RULE = "出征スキル・集結スキルあり、バフ20%をスキルなしの出征容量にかけ、出征で増えた分（スキル＋バフ）を集結容量にも足す";
  function marchPetBonus(lv) { return lv ? 1500 * lv : 0; }
  function rallyPetBonus(lv) { return lv ? 50000 + 10000 * lv : 0; }

  // 戻り値 { march, rally }（入力がない方は null）
  function calcCapacity(m) {
    var mUp = marchPetBonus(m.marchPet) + (m.marchCount != null ? Math.floor(m.marchCount * CAP_BUFF) : 0);
    return {
      march: m.marchCount != null ? m.marchCount + mUp : null,
      rally: m.rallyCount != null ? m.rallyCount + mUp + rallyPetBonus(m.rallyPet) : null
    };
  }

  function calcText(m) {
    return [m.marchCap != null ? "出征 " + m.marchCap.toLocaleString() : "", m.rallyCap != null ? "集結 " + m.rallyCap.toLocaleString() : ""]
      .filter(Boolean).join("／");
  }

  function capText(m) {
    function part(label, count, pet) {
      if (count == null && pet == null) return "";
      return label + (count != null ? count + "部隊" : "") + (pet != null ? " Lv" + pet : "");
    }
    var rally = part("集結", m.rallyCount, m.rallyPet) + (m.rallySpeedPet != null ? " 速度Lv" + m.rallySpeedPet : "");
    return [part("出征", m.marchCount, m.marchPet), rally].filter(Boolean).join("／");
  }

  function gradeRank(g) {
    var i = GRADES.indexOf(g);
    return i < 0 ? GRADES.length : i;
  }

  // ---------- 募集フォーマットの読み取り ----------
  var MARK_CHARS = /[◯△◇◆]/g;

  // 書き方の違う記号を ◯△◇◆ にそろえる（◇白ひし形 と ◆黒ひし形 は別の印なので区別する）。
  // 英字の o・O は名前の一部のことがあるので、ここでは変換しない（AI変換で判断する）
  function normMarks(s) {
    return s
      .replace(/⭕|⚪|⚫|[○〇●◎⚪]/g, "◯")
      .replace(/[▲▵▴∆Δ⚠]/g, "△")
      .replace(/[⋄♢◊]/g, "◇")
      .replace(/[♦⬥⬦🔶🔷🔸🔹]/gu, "◆")
      .replace(/️/g, "");
  }

  function parseEntry(text, ctx) {
    var parens = [];
    var rest = text.replace(/[(（]([^)）]*)[)）]/g, function(_, p) { parens.push(p.replace(/\s/g, "")); return ""; });
    // 括弧の外に書かれた「歩T11」なども兵種・Tとして読む
    rest = rest.replace(/\s*([歩騎弓]*T\d+)\s*$/i, function(_, p) { parens.push(p); return ""; });
    var marks = (rest.match(MARK_CHARS) || []).join("");
    var name = rest.replace(MARK_CHARS, "").trim();
    var m = {
      alliance: ctx.alliance, entry: ctx.entry, grade: ctx.grade, name: name,
      monthly: /[◯○〇]/.test(marks), leaveEarly: /△/.test(marks), vc: /◇/.test(marks), vivian4: /◆/.test(marks),
      troops: "", tier: null, joinAt: "", leaveAt: "", note: ""
    };
    var notes = [];
    parens.forEach(function(p) {
      var tm;
      if (/[〜~～]/.test(p) && /(時|\d:\d)/.test(p)) {
        var parts = p.split(/[〜~～]/);
        if (parts[0]) m.joinAt = parts[0];
        if (parts[1]) m.leaveAt = parts[1];
      } else if ((tm = p.match(/^([歩騎弓]*)T(\d+)$/i))) {
        m.troops = tm[1] ? normTroops(tm[1]) : TROOP_ORDER;
        m.tier = Number(tm[2]);
      } else if (/^[歩騎弓]+$/.test(p)) {
        m.troops = normTroops(p);
      } else if (p) {
        notes.push(p);
      }
    });
    if (m.leaveAt) m.leaveEarly = true;
    m.note = notes.join(" / ");
    return m;
  }

  function parseFormatText(text, defaultAlliance) {
    var ctx = { alliance: defaultAlliance || "", entry: "start", grade: "その他" };
    var inGrade = false; // G行の後ろ（次の行から1人ずつ書かれる形式）にいるか
    var rows = [], errors = [];

    function addEntries(src, lineNo) {
      src.split(/[、,，]/).forEach(function(part) {
        part = part.trim();
        if (!part) return;
        var m = parseEntry(part, ctx);
        if (!m.name) { errors.push(lineNo + "行目「" + part + "」: 名前が読めません"); return; }
        if (!m.alliance) { errors.push(lineNo + "行目「" + m.name + "」: 同盟名がありません（見出しがない場合は同盟名を入力してください）"); return; }
        var r = fitPartial(m);
        r._given = givenKeys(m);
        rows.push(r);
      });
    }

    text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach(function(raw, i) {
      var line = normMarks(raw).trim();
      if (!line) return;
      if (/^[◯○〇△◇◆]\s*[:：]/.test(line)) return; // 凡例

      var gm = line.match(/^(G\s*\d+|その他)\s*[:：]\s*(.*)$/i);
      if (gm) {
        ctx.grade = gm[1].replace(/\s/g, "").toUpperCase().replace("その他".toUpperCase(), "その他");
        inGrade = true;
        addEntries(gm[2], i + 1);
        return;
      }

      // 見出し: 「EGG(最初から参加できる)」「EGG(途中参加)」
      var hm = line.match(/^(.+?)\s*[(（]([^)）]*参加[^)）]*)[)）]\s*[:：]?\s*$/);
      if (hm) {
        ctx.alliance = hm[1].trim();
        ctx.entry = /途中/.test(hm[2]) ? "late" : "start";
        inGrade = false;
        return;
      }
      // 見出し: 「同盟名:TNP」
      var hm3 = line.match(/^同盟名?\s*[:：]\s*(\S.*)$/);
      if (hm3) {
        ctx.alliance = hm3[1].trim();
        ctx.entry = "start";
        inGrade = false;
        return;
      }
      // 見出し: 「EGG:」
      var hm2 = line.match(/^([^:：\s]{1,20})\s*[:：]\s*$/);
      if (hm2) {
        if (hm2[1] !== "同盟名") { ctx.alliance = hm2[1]; ctx.entry = "start"; }
        inGrade = false;
        return;
      }
      // G行の次の行から1人ずつ書かれている形式（印・括弧・Tがある行、または短い行だけを対象にし、挨拶文は無視）
      if (inGrade && (/[◯○〇△◇◆(（]|T\d/.test(line) || (line.length <= 16 && !/[。！？!?]$/.test(line)))) {
        addEntries(line, i + 1);
      }
    });
    return { rows: rows, errors: errors };
  }

  // テキスト中の一番外側の [ ... ] をすべて切り出す（文字列内の括弧は無視）
  function extractJsonArrays(text) {
    var out = [], depth = 0, start = -1, inStr = false, esc = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"' && depth > 0) inStr = true;
      else if (c === "[") { if (depth === 0) start = i; depth++; }
      else if (c === "]" && depth > 0) { depth--; if (depth === 0) out.push(text.slice(start, i + 1)); }
    }
    return out;
  }

  // AIが返したJSONを読み取る。コードブロックや前後の説明文つき、複数の返答を続けて貼った場合も可
  function parseJsonText(text) {
    var list = [], errors = [];
    var arrays = extractJsonArrays(text);
    if (arrays.length) {
      arrays.forEach(function(a, i) {
        try {
          var data = JSON.parse(a);
          if (Array.isArray(data)) list = list.concat(data);
        } catch (e) {
          errors.push((i + 1) + "個目のJSONが読み取れません（AIの返答を最後までコピーできているか確認してください）");
        }
      });
    } else {
      var data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      list = data.members || [];
    }
    var rows = normalize(list);
    var skipped = list.length - rows.length;
    if (skipped) errors.push(skipped + "件: 同盟または名前が空のためスキップ");
    return { rows: rows, errors: errors, blocks: arrays.length };
  }

  // ---------- CSV ----------
  var CSV_COLS = [
    ["alliance", "同盟"], ["entry", "参加"], ["grade", "区分"], ["name", "名前"],
    ["monthly", "マンスリー"], ["leaveEarly", "途中抜け"], ["vc", "VC"], ["vivian4", "ビビアン星4"], ["mayChange", "変更の可能性"],
    ["troops", "兵種"], ["tier", "T"], ["joinAt", "参加開始"], ["leaveAt", "抜ける時刻"], ["note", "備考"]
  ].concat(NUM_FIELDS);

  function splitCsvLine(line) {
    if (line.indexOf("\t") >= 0) return line.split("\t");
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCsv(text) {
    var lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(function(l) { return l.trim(); });
    var list = [];
    lines.forEach(function(line, i) {
      var c = splitCsvLine(line);
      if (i === 0 && c[0].trim() === "同盟") return;
      var o = {};
      CSV_COLS.forEach(function(col, j) { o[col[0]] = c[j]; });
      list.push(o);
    });
    var rows = normalize(list);
    var skipped = list.length - rows.length;
    return { rows: rows, errors: skipped ? [skipped + "行: 同盟または名前が空のためスキップ"] : [] };
  }

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- 描画 ----------
  // 保存済みの内容（base）からの変更件数（ユーザー・イベント・参加情報の追加・変更・削除）
  function countChanges(base, local) {
    var n = 0;
    ["users", "events", "entries"].forEach(function(k) {
      var b = byId(base[k]), l = byId(local[k]);
      local[k].forEach(function(x) { if (!b[x.id] || JSON.stringify(b[x.id]) !== JSON.stringify(x)) n++; });
      base[k].forEach(function(x) { if (!l[x.id]) n++; });
    });
    return n;
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return (d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function renderState() {
    var dirty = !!publishedJson && serialize() !== publishedJson;
    var n = dirty ? countChanges(JSON.parse(publishedJson), state) : 0;
    $("saveCard").className = "card save-card " + (dirty ? "dirty" : "clean");
    $("saveTitle").textContent = dirty
      ? "⚠ まだ保存していない変更があります（" + (n || 1) + "件）"
      : "✅ すべて保存済みです";
    $("saveSub").textContent = dirty
      ? "「保存する」を押すまで、この変更はこの端末にだけ残っていて、他の人には見えません。"
      : (lastSaved ? "最終保存: " + formatTime(lastSaved) : "");
    $("publishBtn").disabled = !dirty || saving;
    $("discardBtn").style.display = dirty ? "" : "none";

    var fb = $("floatSaveBtn");
    fb.className = "float-save " + (dirty ? "dirty" : "clean") + (saveCardVisible ? "" : " show");
    fb.textContent = saving ? "保存中…" : dirty ? "💾 保存する（未保存 " + (n || 1) + "件）" : "✅ 保存済み";
    fb.disabled = !dirty || saving;
  }

  // 保存の帯が見えているかどうか（見えないときだけ右下の保存ボタンを出す）
  var saveCardVisible = true;
  var saving = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function(es) {
      saveCardVisible = es[0].isIntersecting;
      if (publishedJson) renderState();
    }).observe($("saveCard"));
  }
  on("floatSaveBtn", "click", function() { publish(false); });

  function sortedEvents() {
    return state.events.slice().sort(function(a, b) {
      return b.date.localeCompare(a.date) || EVENT_TYPES.indexOf(a.type) - EVENT_TYPES.indexOf(b.type);
    });
  }

  function eventStatus(ev) {
    return !ev ? "" : ev.done ? "done" : ev.open ? "open" : "running";
  }
  var STATUS_LABEL = { open: "受付中", running: "イベント進行中", done: "完了" };

  function entryCount(ev) {
    return state.entries.filter(function(x) { return x.eventId === ev.id && x.entry !== "absent"; }).length;
  }

  function renderEvents() {
    if (!$("eventSelect")) return;
    var all = sortedEvents();
    var active = all.filter(function(e) { return !e.done; });
    var doneEvents = all.filter(function(e) { return e.done; });
    if (!eventById(currentEventId)) currentEventId = active.length ? active[0].id : all.length ? all[0].id : null;
    // 一覧には完了していないイベント（完了したイベントを表示中ならそれも）
    var events = active.concat(doneEvents.filter(function(e) { return e.id === currentEventId; }));
    try {
      if (currentEventId) localStorage.setItem(EVENT_KEY, currentEventId);
      else localStorage.removeItem(EVENT_KEY);
    } catch (e) {}

    $("eventSelect").innerHTML = events.length
      ? events.map(function(ev) {
          return '<option value="' + ev.id + '"' + (ev.id === currentEventId ? " selected" : "") + '>' +
            escapeHtml(eventLabel(ev)) + '（' + entryCount(ev) + '人）【' + STATUS_LABEL[eventStatus(ev)] + '】</option>';
        }).join("")
      : '<option value="">（イベントがありません）</option>';
    $("eventSelect").disabled = !events.length;
    $("deleteEventBtn").disabled = !events.length;
    var cur = eventById(currentEventId), st = eventStatus(cur);
    $("openState").textContent = STATUS_LABEL[st] || "";
    $("openState").className = "pill " + ({ open: "saved", running: "running", done: "done" }[st] || "");
    $("toggleOpenBtn").style.display = cur && st !== "done" ? "inline-block" : "none";
    $("toggleOpenBtn").textContent = st === "open" ? "受付を締め切る（進行中にする）" : "受付を始める";
    $("doneBtn").style.display = cur && st !== "open" ? "inline-block" : "none";
    $("doneBtn").textContent = st === "done" ? "進行中に戻す" : "完了にする";

    $("doneCard").style.display = doneEvents.length ? "block" : "none";
    $("doneCount").textContent = "（" + doneEvents.length + "件）";
    $("doneList").innerHTML = doneEvents.map(function(ev) {
      return '<div class="done-row' + (ev.id === currentEventId ? " current" : "") + '"><span class="label">' +
        escapeHtml(eventLabel(ev)) + '（' + entryCount(ev) + '人）</span>' +
        '<button type="button" class="small sub-btn" data-show="' + ev.id + '">' + (ev.id === currentEventId ? "表示中" : "表示") + '</button>' +
        '<button type="button" class="small sub-btn" data-reopen="' + ev.id + '">進行中に戻す</button></div>';
    }).join("");

    var has = !!currentEventId;
    $("eventView").style.display = has ? "block" : "none";
    renderRuinTargets();
    $("noEventView").style.display = has ? "none" : "block";
    document.querySelectorAll(".event-name").forEach(function(el) {
      el.textContent = eventLabel(eventById(currentEventId));
    });
  }

  // イベントページ：遺跡争奪のとき、時間帯ごとの対象（要塞・遺跡）をチェックで選ぶ欄（チーム分けで使う）
  function renderRuinTargets() {
    if (!$("newEventType") || !$("eventView")) return; // イベントページだけ
    var ev = eventById(currentEventId), card = $("ruinTargetsCard");
    if (!ev || ev.type !== RUIN_TYPE) { if (card) card.style.display = "none"; return; }
    if (!card) {
      card = document.createElement("div");
      card.className = "card";
      card.id = "ruinTargetsCard";
      $("eventView").insertBefore(card, $("eventView").firstChild);
      // 1つの要塞・遺跡は1つの時間にだけ対応（ラジオ）。選んだ時間をもう一度押すと外れる
      card.addEventListener("click", function(e) {
        var cb = e.target, cur = eventById(currentEventId);
        if (!cb.dataset || !cb.dataset.slot || !cur) return;
        var t = normRuinTargets(cur.ruinTargets) || normRuinTargets({});
        var k = cb.dataset.slot, name = cb.dataset.target, was = t[k].indexOf(name) >= 0;
        RUIN_SLOTS.forEach(function(s) { t[s] = t[s].filter(function(x) { return x !== name; }); });
        if (!was) t[k].push(name);
        cur.ruinTargets = normRuinTargets(t); // 要塞→遺跡の番号順にそろえる
        commit();
      });
    }
    card.style.display = "block";
    var t = ev.ruinTargets || {};
    card.innerHTML = '<h2>🏯 時間帯ごとの対象（要塞・遺跡）</h2>' +
      '<div class="hint">この遺跡争奪で、時間帯ごとにどの要塞・遺跡を狙うかを選びます（チーム分けで使います）。1つの要塞・遺跡は1つの時間にだけ選べます。選んだところをもう一度押すと外れます。変えたら「💾 保存する」を押してください。</div>' +
      '<div style="overflow-x: auto;"><table style="margin-top: 8px;"><thead><tr><th>時間</th><th>要塞</th><th>遺跡</th></tr></thead><tbody>' +
      RUIN_SLOTS.map(function(k) {
        var sel = t[k] || [];
        function box(name) {
          return '<label style="white-space: nowrap; margin-right: 8px;"><input type="radio" name="rt-' + name + '" data-slot="' + k + '" data-target="' + name + '"' +
            (sel.indexOf(name) >= 0 ? " checked" : "") + '> ' + name.replace(/^(要塞|遺跡)/, "") + '</label>';
        }
        return '<tr><td style="white-space: nowrap;">' + slotLabel(k) + '</td>' +
          '<td>' + RUIN_TARGETS.filter(function(x) { return x.indexOf("要塞") === 0; }).map(box).join("") + '</td>' +
          '<td>' + RUIN_TARGETS.filter(function(x) { return x.indexOf("遺跡") === 0; }).map(box).join("") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function defaultCompare(a, b) {
    return a.alliance.localeCompare(b.alliance, "ja")
      || ENTRY_ORDER.indexOf(a.entry) - ENTRY_ORDER.indexOf(b.entry)
      || gradeRank(a.grade) - gradeRank(b.grade)
      || (b.tier || 0) - (a.tier || 0);
  }

  function sortRows(list) {
    if (!sortKey) return list.sort(defaultCompare);
    return list.sort(function(a, b) {
      var r;
      if (sortKey === "grade") r = gradeRank(a.grade) - gradeRank(b.grade);
      else if (sortKey === "tier") r = (b.tier || 0) - (a.tier || 0);
      else r = String(a[sortKey]).localeCompare(String(b[sortKey]), "ja");
      return r * sortDir || defaultCompare(a, b);
    });
  }

  function memberRowHtml(m, withOps) {
    return '<td>' + escapeHtml(m.alliance) + '</td>' +
      '<td><span class="tag ' + m.entry + '">' + ENTRY_SHORT[m.entry] + '</span>' +
        (m.mayChange ? ' <span class="tag new">変更かも</span>' : '') + '</td>' +
      '<td>' + escapeHtml(m.grade) + '</td>' +
      '<td>' + escapeHtml(m.name) + (m.proxyBy ? ' <span class="hint">（代理: ' + escapeHtml(m.proxyBy) + '）</span>' : '') + '</td>' +
      '<td class="marks">' + marksOf(m) + '</td>' +
      '<td>' + escapeHtml(troopText(m)) + '</td>' +
      '<td>' + escapeHtml(timeText(m)) + '</td>' +
      '<td class="num">' + escapeHtml(capText(m)) + '</td>' +
      '<td class="num" style="white-space: nowrap;">' + escapeHtml(calcText(m)) + '</td>' +
      '<td>' + escapeHtml(m.note) + '</td>' +
      '<td style="white-space: nowrap;">' + escapeHtml(m.updatedAt ? formatTime(m.updatedAt) : "") + '</td>' +
      (withOps
        ? '<td class="ops"><button class="small sub-btn" data-act="edit">変更</button> ' +
          '<button class="small danger" data-act="delete">削除</button></td>'
        : "");
  }

  // ---------- 遺跡争奪の表示（時間ごとの ◯／△／×） ----------
  var normalHeadHtml = null, normalLegend = null;
  function setEntryHead(ruin) {
    var table = $("memberBody").closest("table"), tr = table.querySelector("thead tr");
    var legend = table.parentNode.querySelector(".legend");
    if (normalHeadHtml === null) { normalHeadHtml = tr.innerHTML; normalLegend = legend ? legend.textContent : ""; }
    var want = ruin
      ? '<th data-key="alliance">同盟</th><th data-key="entry">参加</th><th data-key="name">名前</th>' +
        ruinTimes().map(function(k) { return '<th class="nosort">' + slotLabel(k) + '</th>'; }).join("") +
        '<th class="nosort">備考</th><th class="nosort">更新日時</th><th class="nosort"></th>'
      : normalHeadHtml;
    var mode = ruin ? "ruin:" + ruinTimes().join(",") : "normal"; // 時間の列はイベントの対象で変わる
    if (tr.dataset.mode !== mode) { tr.innerHTML = want; tr.dataset.mode = mode; }
    if (legend) legend.textContent = ruin ? "◯:参加　△:行けるかも　×:不参加" : normalLegend;
    var box = $("ruinSumBox");
    if (!box && ruin) {
      box = document.createElement("div");
      box.id = "ruinSumBox";
      box.style.margin = "0 0 12px";
      box.innerHTML = '<div class="hint">Discordに貼る用の集計（名前の横の△＝行けるかも。不参加・未回答の人は出ません）</div>' +
        '<pre id="ruinSummary" style="white-space: pre-wrap; background: #f6f7f9; border: 1px solid #e3e6ea; border-radius: 6px; padding: 8px 10px; margin: 6px 0; font-size: 13px;"></pre>' +
        '<button type="button" class="small sub-btn" id="ruinCopyBtn">コピー</button>';
      table.parentNode.insertBefore(box, table);
      $("ruinCopyBtn").addEventListener("click", function() {
        var btn = this;
        navigator.clipboard.writeText($("ruinSummary").textContent).then(function() {
          btn.textContent = "コピーしました";
          setTimeout(function() { btn.textContent = "コピー"; }, 1500);
        });
      });
    }
    if (box) box.style.display = ruin ? "block" : "none";
  }

  // 登録ページ（entry/）の「登録状況を見る」と同じ形：「12時(2)・16人：もち、あっきぃ△」（(2)＝その時間の対象の数、人数＝参加＋行けるかも）
  function ruinSummary(rows) {
    var ev = eventById(currentEventId), lines = [eventLabel(ev)];
    ruinTimes().forEach(function(k) {
      var names = [];
      rows.forEach(function(m) {
        var v = (m.slots || {})[k];
        if (v === "yes") names.push(m.name);
        else if (v === "maybe") names.push(m.name + "△");
      });
      var n = ((ev && ev.ruinTargets) || {})[k] ? ev.ruinTargets[k].length : 0;
      lines.push(k + "時" + (n ? "(" + n + ")" : "") + "・" + names.length + "人：" + names.join("、"));
    });
    return lines.join("\n");
  }

  function ruinRowHtml(m) {
    return '<td>' + escapeHtml(m.alliance) + '</td>' +
      '<td><span class="tag ' + m.entry + '">' + (m.entry === "absent" ? "不参加" : "参加") + '</span></td>' +
      '<td>' + escapeHtml(m.name) + (m.proxyBy ? ' <span class="hint">（代理: ' + escapeHtml(m.proxyBy) + '）</span>' : '') + '</td>' +
      ruinTimes().map(function(k) { return '<td style="text-align: center;">' + (SLOT_MARK[(m.slots || {})[k]] || "") + '</td>'; }).join("") +
      '<td>' + escapeHtml(m.note) + '</td>' +
      '<td style="white-space: nowrap;">' + escapeHtml(m.updatedAt ? formatTime(m.updatedAt) : "") + '</td>' +
      '<td class="ops"><button class="small sub-btn" data-act="edit">変更</button> ' +
      '<button class="small danger" data-act="delete">削除</button></td>';
  }

  function renderEntries() {
    if (!$("memberBody")) return;
    var rows = eventRows();
    var ruin = isRuinEvent(currentEventId);
    setEntryHead(ruin);
    if (ruin) $("ruinSummary").textContent = ruinSummary(sortRows(rows));

    var alliances = [];
    rows.forEach(function(m) { if (alliances.indexOf(m.alliance) < 0) alliances.push(m.alliance); });
    var sel = $("filterAlliance"), cur = sel.value;
    sel.innerHTML = '<option value="">すべての同盟</option>' + alliances.map(function(a) {
      return '<option' + (a === cur ? " selected" : "") + '>' + escapeHtml(a) + '</option>';
    }).join("");

    var q = $("filterInput").value.trim().toLowerCase();
    var fa = sel.value;
    var html = [], shown = 0;
    sortRows(rows).forEach(function(m) {
      if (fa && m.alliance !== fa) return;
      if (q && (m.name + " " + m.note).toLowerCase().indexOf(q) < 0) return;
      shown++;
      html.push('<tr data-id="' + m.id + '"' + (m.id === editingId ? ' class="editing"' : "") + '>' + (ruin ? ruinRowHtml(m) : memberRowHtml(m, true)) + '</tr>');
    });
    if (!rows.length) {
      html.push('<tr><td colspan="12" class="hint" style="text-align:center;">このイベントにはまだ参加者が登録されていません</td></tr>');
    }
    $("memberBody").innerHTML = html.join("");
    $("countText").textContent = (q || fa) ? "（" + shown + " / " + rows.length + "人）" : "（" + rows.length + "人）";
    document.querySelectorAll("th[data-key]").forEach(function(th) {
      var label = th.textContent.replace(/ [▲▼]$/, "");
      th.textContent = label + (th.dataset.key === sortKey ? (sortDir > 0 ? " ▲" : " ▼") : "");
    });
  }

  // ユーザー一覧の名前の下に出す「名前の履歴（いつまで）」と、履歴にない旧名・別表記
  function historyHtml(u) {
    var hist = u.nameHistory || [], inHist = {};
    hist.forEach(function(h) { inHist[nameKey(h.name)] = true; });
    var others = (u.aliases || []).filter(function(a) { return !inHist[nameKey(a)]; });
    return (hist.length ? '<div class="alias">名前の履歴: ' + hist.map(function(h) {
        return escapeHtml(h.name) + (h.until ? "（〜" + escapeHtml(formatTime(h.until)) + "）" : "");
      }).join(" → ") + " → " + escapeHtml(u.name) + '</div>' : "") +
      (others.length ? '<div class="alias">旧名・別表記: ' + escapeHtml(others.join("、")) + '</div>' : "");
  }

  // fName（参加者フォーム）・notSameA/B（ユーザー管理）など、ページをまたいで使うdatalistの中身。
  // userBodyを持つページ（ユーザー管理）以外でも必要なので、renderUsers()と切り離して常に呼ぶ
  function renderNameAllianceLists() {
    var allianceSet = {};
    state.users.forEach(function(u) { if (u.alliance) allianceSet[u.alliance] = true; });
    if ($("allianceList")) $("allianceList").innerHTML = Object.keys(allianceSet).map(function(a) { return '<option value="' + escapeHtml(a) + '">'; }).join("");
    if ($("nameList")) $("nameList").innerHTML = state.users.map(function(u) {
      return '<option value="' + escapeHtml(u.name) + '">' + escapeHtml(u.alliance) + '</option>';
    }).join("");
  }

  function renderUsers() {
    if (!$("userBody")) return;
    var stats = {};
    state.entries.forEach(function(e) {
      var s = stats[e.userId] || (stats[e.userId] = { count: 0, last: null });
      s.count++;
      var ev = eventById(e.eventId);
      if (ev && (!s.last || ev.date > s.last.date)) s.last = ev;
    });

    // 似た名前の候補
    function userLabel(u) {
      var s = stats[u.id];
      return "<b>" + escapeHtml(u.name) + "</b>（" + escapeHtml(u.alliance || "同盟なし") + "・参加" + (s ? s.count : 0) + "回）";
    }
    var pairs = similarPairs();
    $("simCount").textContent = "（" + pairs.length + "組）";
    $("simPairs").innerHTML = pairs.length ? pairs.map(function(p) {
      return '<div class="sim-pair" data-a="' + p.a.id + '" data-b="' + p.b.id + '">' +
        '<span class="names">' + userLabel(p.a) + ' ⇔ ' + userLabel(p.b) + '</span>' +
        '<button class="small sub-btn" data-sact="keepA">同一人物：「' + escapeHtml(p.a.name) + '」を残す</button>' +
        '<button class="small sub-btn" data-sact="keepB">同一人物：「' + escapeHtml(p.b.name) + '」を残す</button>' +
        '<button class="small sub-btn" data-sact="notSame">別人</button></div>';
    }).join("") : '<div class="hint" style="padding: 8px 0;">似た名前のユーザーはいません</div>';

    // 別人リスト
    $("notSameCount").textContent = "（" + state.notSame.length + "組）";
    $("notSameList").innerHTML = state.notSame.map(function(p) {
      var ids = p.split("|"), a = userById(ids[0]), b = userById(ids[1]);
      if (!a || !b) return "";
      return '<div class="sim-pair"><span class="names">' + userLabel(a) + ' と ' + userLabel(b) + '</span>' +
        '<button class="small sub-btn" data-unpair="' + escapeHtml(p) + '">解除</button></div>';
    }).join("") || '<div class="hint" style="padding: 8px 0;">まだありません</div>';

    var q = $("userFilterInput").value.trim().toLowerCase();
    var list = state.users.map(function(u) {
      var s = stats[u.id] || { count: 0, last: null };
      return { u: u, count: s.count, last: s.last };
    }).filter(function(r) {
      return !q || (userNames(r.u).join(" ") + " " + r.u.alliance).toLowerCase().indexOf(q) >= 0;
    });
    list.sort(function(a, b) {
      var r;
      if (userSortKey === "count") r = a.count - b.count;
      else if (userSortKey === "last") r = (a.last ? a.last.date : "").localeCompare(b.last ? b.last.date : "");
      else r = String(a.u[userSortKey]).localeCompare(String(b.u[userSortKey]), "ja");
      return r * userSortDir || a.u.name.localeCompare(b.u.name, "ja");
    });

    $("userBody").innerHTML = list.length ? list.map(function(r) {
      return '<tr data-uid="' + r.u.id + '">' +
        '<td>' + escapeHtml(r.u.name) +
        historyHtml(r.u) + '</td>' +
        '<td>' + escapeHtml(r.u.alliance) + '</td>' +
        '<td class="num">' + r.count + '</td>' +
        '<td>' + escapeHtml(eventLabel(r.last)) + '</td>' +
        '<td class="ops"><button class="small sub-btn" data-uact="rename">名前変更</button> ' +
        '<button class="small sub-btn" data-uact="merge">統合</button> ' +
        '<button class="small danger" data-uact="delete">削除</button></td></tr>';
    }).join("") : '<tr><td colspan="5" class="hint" style="text-align:center;">ユーザーはまだいません</td></tr>';
    $("userCountText").textContent = q ? "（" + list.length + " / " + state.users.length + "人）" : "（" + state.users.length + "人）";
    document.querySelectorAll("th[data-ukey]").forEach(function(th) {
      var label = th.textContent.replace(/ [▲▼]$/, "");
      th.textContent = label + (th.dataset.ukey === userSortKey ? (userSortDir > 0 ? " ▲" : " ▼") : "");
    });
  }

  function render() {
    renderState();
    renderEvents();
    renderNameAllianceLists();
    if (currentEventId) {
      renderEntries();
      if ($("promptText")) $("promptText").value = buildPrompt();
      refreshAiText();
    }
    renderUsers();
  }

  // 見出しは遺跡争奪のとき差し替えるので、クリックはまとめて受ける
  document.addEventListener("click", function(e) {
    var th = e.target.closest && e.target.closest("th[data-key]");
    if (!th) return;
    var key = th.dataset.key;
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
    renderEntries();
  });
  document.querySelectorAll("th[data-ukey]").forEach(function(th) {
    th.addEventListener("click", function() {
      var key = th.dataset.ukey;
      if (userSortKey === key) userSortDir = -userSortDir;
      else { userSortKey = key; userSortDir = key === "count" || key === "last" ? -1 : 1; }
      renderUsers();
    });
  });
  on("filterInput", "input", renderEntries);
  on("filterAlliance", "change", renderEntries);

  on("userFilterInput", "input", renderUsers);

  function setMsg(el, text, ok) {
    el.textContent = text;
    el.className = "msg " + (ok ? "ok" : "err");
  }

  // ---------- イベント ----------
  if ($("newEventType")) { // イベント欄があるページだけ
    $("newEventType").innerHTML = EVENT_TYPES.map(function(t) { return "<option>" + t + "</option>"; }).join("");
    $("newEventDate").value = today();
  }

  on("eventSelect", "change", function() {
    currentEventId = this.value;
    resetForm(false);
    // ページによって無い欄があるので、ある欄だけ消す（無い欄で例外になると下の一覧が切り替わらない）
    if ($("formMsg")) $("formMsg").textContent = "";
    if ($("bulkMsg")) $("bulkMsg").textContent = "";
    if ($("previewWrap")) $("previewWrap").style.display = "none";
    if ($("formatOut")) $("formatOut").value = "";
    render();
  });

  on("createEventBtn", "click", function() {
    var type = $("newEventType").value, date = $("newEventDate").value;
    if (!date) { setMsg($("eventMsg"), "開催日を選んでください", false); return; }
    var ev = state.events.find(function(e) { return e.type === type && e.date === date; });
    if (ev) {
      setMsg($("eventMsg"), "「" + eventLabel(ev) + "」はすでにあるので選択しました", true);
    } else {
      ev = { id: newId("e"), type: type, date: date };
      state.events.push(ev);
      setMsg($("eventMsg"), "「" + eventLabel(ev) + "」を作成しました。個人登録ページに出すには「受付を始める」→「💾 保存する」を押してください", true);
    }
    currentEventId = ev.id;
    resetForm(false);
    commit();
  });

  on("deleteEventBtn", "click", function() {
    var ev = eventById(currentEventId);
    if (!ev) return;
    var n = state.entries.filter(function(x) { return x.eventId === ev.id; }).length;
    if (!confirm("「" + eventLabel(ev) + "」と参加者" + n + "人分の登録を削除します（ユーザー一覧からは消えません）。よろしいですか？")) return;
    state.entries = state.entries.filter(function(x) { return x.eventId !== ev.id; });
    state.events = state.events.filter(function(e) { return e.id !== ev.id; });
    currentEventId = null;
    resetForm(false);
    setMsg($("eventMsg"), "「" + eventLabel(ev) + "」を削除しました", true);
    commit();
  });

  function setStatus(ev, st) {
    ev.open = st === "open";
    ev.done = st === "done";
    setMsg($("eventMsg"), "「" + eventLabel(ev) + "」を「" + STATUS_LABEL[st] + "」にしました。「💾 保存する」を押すと反映されます", true);
    commit();
  }

  on("toggleOpenBtn", "click", function() {
    var ev = eventById(currentEventId);
    if (ev) setStatus(ev, ev.open ? "running" : "open");
  });

  on("doneBtn", "click", function() {
    var ev = eventById(currentEventId);
    if (ev) setStatus(ev, ev.done ? "running" : "done");
  });

  on("doneList", "click", function(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.show) {
      currentEventId = btn.dataset.show;
      resetForm(false);
      render();
    } else if (btn.dataset.reopen) {
      var ev = eventById(btn.dataset.reopen);
      if (ev) { currentEventId = ev.id; setStatus(ev, "running"); }
    }
  });

  on("copyEntryUrlBtn", "click", function() {
    copyText(new URL("../entry/", location.href).href, this);
  });

  document.querySelectorAll("select[data-pet]").forEach(function(sel) {
    var html = '<option value="">（未入力）</option><option value="0">持っていない</option>';
    for (var lv = PET_MAX[sel.dataset.pet]; lv >= 1; lv--) html += '<option value="' + lv + '">Lv' + lv + '</option>';
    sel.innerHTML = html;
  });

  // ---------- 1人ずつ登録・変更・キャンセル ----------
  function readForm() {
    var troops = "";
    document.querySelectorAll(".fTroop:checked").forEach(function(cb) { troops += cb.value; });
    var tier = $("fTier").value.trim();
    var m = {
      alliance: $("fAlliance").value.trim(),
      entry: $("fEntry").value,
      grade: $("fGrade").value,
      name: $("fName").value.trim(),
      monthly: $("fMonthly").checked,
      leaveEarly: $("fLeaveEarly").checked,
      vc: $("fVc").checked,
      vivian4: $("fVivian4").checked,
      mayChange: $("fMayChange").checked,
      troops: normTroops(troops),
      tier: tier ? Number(tier) : null,
      joinAt: $("fJoinAt").value.trim(),
      leaveAt: $("fLeaveAt").value.trim(),
      note: $("fNote").value.trim(),
      marchCount: num($("fMarchCount").value),
      marchPet: num($("fMarchPet").value),
      rallyCount: num($("fRallyCount").value),
      rallyPet: num($("fRallyPet").value),
      rallySpeedPet: num($("fRallySpeedPet").value)
    };
    if (m.leaveAt) m.leaveEarly = true;
    return m;
  }

  function fillForm(m) {
    $("fAlliance").value = m.alliance;
    $("fEntry").value = m.entry;
    $("fGrade").value = m.grade;
    $("fName").value = m.name;
    $("fMonthly").checked = m.monthly;
    $("fLeaveEarly").checked = m.leaveEarly;
    $("fVc").checked = m.vc;
    $("fVivian4").checked = m.vivian4;
    $("fMayChange").checked = !!m.mayChange;
    document.querySelectorAll(".fTroop").forEach(function(cb) { cb.checked = m.troops.indexOf(cb.value) >= 0; });
    $("fTier").value = m.tier == null ? "" : m.tier;
    $("fJoinAt").value = m.joinAt;
    $("fLeaveAt").value = m.leaveAt;
    $("fNote").value = m.note;
    $("fMarchCount").value = m.marchCount == null ? "" : m.marchCount;
    $("fMarchPet").value = m.marchPet == null ? "" : m.marchPet;
    $("fRallyCount").value = m.rallyCount == null ? "" : m.rallyCount;
    $("fRallyPet").value = m.rallyPet == null ? "" : m.rallyPet;
    $("fRallySpeedPet").value = m.rallySpeedPet == null ? "" : m.rallySpeedPet;
  }

  // キャンセル／登録後のリセット。同盟・参加・区分は連続入力しやすいよう残す
  function resetForm(keepContext) {
    editingId = null;
    if (!$("formCard")) return;
    var ctx = { alliance: $("fAlliance").value, entry: $("fEntry").value, grade: $("fGrade").value };
    fillForm({ alliance: "", entry: "start", grade: "G7", name: "", monthly: false, leaveEarly: false, vc: false,
      vivian4: false, mayChange: false, troops: "", tier: null, joinAt: "", leaveAt: "", note: "",
      marchCount: null, marchPet: null, rallyCount: null, rallyPet: null, rallySpeedPet: null });
    if (keepContext) {
      $("fAlliance").value = ctx.alliance; $("fEntry").value = ctx.entry; $("fGrade").value = ctx.grade;
    }
    $("formCard").classList.remove("editing");
    $("formTitle").textContent = "1人ずつ登録";
    $("nameHint").innerHTML = "";
    $("saveBtn").textContent = "登録";
  }

  function startEdit(m) {
    editingId = m.id;
    fillForm(m);
    $("formCard").classList.add("editing");
    $("formTitle").textContent = "参加情報の変更";
    $("editBanner").textContent = "「" + m.name + "」（" + m.alliance + "）を変更中です。保存しない場合はキャンセルを押してください。" +
      "名前そのものの変更（改名）は下の「ユーザー一覧」で行ってください。";
    $("saveBtn").textContent = "変更を保存";
    $("formMsg").textContent = "";
    renderEntries();
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
    $("fName").focus();
  }

  // 登録済みユーザーの名前を選んだら、同盟が空なら最新の同盟を入れる
  on("fName", "change", function() {
    var u = findUserByName(this.value);
    if (u && !$("fAlliance").value.trim()) $("fAlliance").value = u.alliance;
  });

  // 入力中の名前が既存ユーザーと一致しないとき、似ている既存ユーザーを表示（押すとその名前にする）
  function renderNameHint() {
    var name = $("fName").value.trim();
    var hint = $("nameHint");
    if (!name || findUserByName(name)) { hint.innerHTML = ""; return; }
    var cands = similarUsers(name);
    hint.innerHTML = cands.length
      ? "似ている既存ユーザー: " + cands.map(function(c) {
          return '<button type="button" class="small sub-btn" data-uid="' + c.u.id + '">' +
            escapeHtml(c.u.name) + "（" + escapeHtml(c.u.alliance || "同盟なし") + "）</button>";
        }).join("") + "<br>同じ人ならボタンを押してください。押さずに登録すると新規ユーザーになります。"
      : "";
  }
  on("fName", "input", renderNameHint);
  on("nameHint", "click", function(e) {
    var btn = e.target.closest("button[data-uid]");
    if (!btn) return;
    var u = userById(btn.dataset.uid);
    if (!u) return;
    $("fName").value = u.name;
    $("fAlliance").value = u.alliance;
    renderNameHint();
  });

  on("saveBtn", "click", function() {
    var m = readForm();
    if (!m.alliance || !m.name) { setMsg($("formMsg"), "同盟と名前は必須です", false); return; }
    if (m.tier != null && !(m.tier > 0)) { setMsg($("formMsg"), "兵士レベルは数字で入力してください", false); return; }
    var user = findUserByName(m.name);
    var existing = user ? entryOf(currentEventId, user.id) : null;

    if (editingId) {
      if (existing && existing.id !== editingId) {
        setMsg($("formMsg"), "「" + m.name + "」はこのイベントの別の行にすでに登録されています", false);
        return;
      }
      var u = ensureUser(m.name, m.alliance);
      var idx = state.entries.findIndex(function(x) { return x.id === editingId; });
      m.proxyBy = state.entries[idx].proxyBy || ""; // 管理画面で直しても、代理入力した人の記録は残す
      if (!m.slots && state.entries[idx].slots) m.slots = state.entries[idx].slots; // 遺跡争奪の時間も残す（フォームに欄が無いため）
      state.entries[idx] = toEntry(m, u.user.id, editingId);
      resetForm(false);
      commit();
      setMsg($("formMsg"), "「" + m.name + "」を変更しました" + (u.created ? "（新規ユーザーとして登録）" : ""), true);
    } else {
      if (existing && !confirm("「" + m.name + "」はこのイベントに登録済みです。上書きしますか？")) return;
      if (!user) {
        var cands = similarUsers(m.name);
        if (cands.length && !confirm("「" + m.name + "」は新規ユーザーとして登録されます。\n似ている既存ユーザー: " +
          cands.map(function(c) { return c.u.name; }).join("、") + "\n新規ユーザーで登録しますか？（同じ人なら「キャンセル」して名前の下のボタンを押してください）")) return;
      }
      var res = upsertEntry(m);
      resetForm(true);
      commit();
      setMsg($("formMsg"), "「" + m.name + "」を" + (res.result === "added" ? "登録" : "更新") + "しました" +
        (res.newUser ? "（新規ユーザー）" : ""), true);
      $("fName").focus();
    }
  });

  on("cancelBtn", "click", function() {
    resetForm(false);
    $("formMsg").textContent = "";
    renderEntries();
  });

  on("memberBody", "click", function(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.closest("tr").dataset.id;
    var row = eventRows().find(function(m) { return m.id === id; });
    if (!row) return;
    if (btn.dataset.act === "edit") {
      startEdit(row);
    } else if (btn.dataset.act === "delete") {
      if (!confirm("「" + row.name + "」をこのイベントの参加者から外しますか？（ユーザー一覧には残ります）")) return;
      if (editingId === id) resetForm(false);
      state.entries = state.entries.filter(function(x) { return x.id !== id; });
      commit();
    }
  });

  // ---------- ユーザー一覧の操作 ----------
  on("userBody", "click", function(e) {
    var btn = e.target.closest("button[data-uact]");
    if (!btn) return;
    var u = userById(btn.closest("tr").dataset.uid);
    if (!u) return;
    var act = btn.dataset.uact;
    var other, res;

    if (act === "rename") {
      var newName = (prompt("「" + u.name + "」の新しい名前", u.name) || "").trim();
      if (!newName || newName === u.name) return;
      other = findUserByName(newName);
      if (other && other.id !== u.id) {
        if (!confirm("「" + newName + "」はすでに登録されています。「" + u.name + "」を「" + newName + "」に統合しますか？")) return;
        res = mergeUsers(u, other);
        setMsg($("userMsg"), "「" + u.name + "」を「" + other.name + "」に統合しました（参加記録 " + res.moved + "件を移動）", true);
      } else {
        renameUser(u, newName);
        setMsg($("userMsg"), "名前を「" + newName + "」に変更しました（旧名は別表記として残ります）", true);
      }
      commit();
    } else if (act === "merge") {
      var target = (prompt("「" + u.name + "」を統合する先のユーザー名（同じ人の、残したいほうの名前）") || "").trim();
      if (!target) return;
      other = findUserByName(target);
      if (!other) { alert("「" + target + "」というユーザーは見つかりません"); return; }
      if (other.id === u.id) return;
      if (!confirm("「" + u.name + "」の参加記録を「" + other.name + "」に移して、「" + u.name + "」を削除します。よろしいですか？")) return;
      res = mergeUsers(u, other);
      setMsg($("userMsg"), "「" + u.name + "」を「" + other.name + "」に統合しました（参加記録 " + res.moved + "件を移動" +
        (res.dropped ? "・同じイベントで重複していた " + res.dropped + "件は統合先を残しました" : "") + "）", true);
      commit();
    } else if (act === "delete") {
      var n = state.entries.filter(function(x) { return x.userId === u.id; }).length;
      if (!confirm("「" + u.name + "」を削除します。参加記録 " + n + "件も削除されます。よろしいですか？")) return;
      state.entries = state.entries.filter(function(x) { return x.userId !== u.id; });
      state.users = state.users.filter(function(x) { return x.id !== u.id; });
      if (editingId && !state.entries.some(function(x) { return x.id === editingId; })) resetForm(false);
      setMsg($("userMsg"), "「" + u.name + "」を削除しました", true);
      commit();
    }
  });

  on("simPairs", "click", function(e) {
    var btn = e.target.closest("button[data-sact]");
    if (!btn) return;
    var box = btn.closest(".sim-pair");
    var a = userById(box.dataset.a), b = userById(box.dataset.b);
    if (!a || !b) return;
    var act = btn.dataset.sact, res;
    if (act === "notSame") {
      state.notSame.push(pairKey(a.id, b.id));
      setMsg($("userMsg"), "「" + a.name + "」と「" + b.name + "」を別人として記録しました", true);
    } else {
      var keep = act === "keepA" ? a : b, drop = act === "keepA" ? b : a;
      res = mergeUsers(drop, keep);
      setMsg($("userMsg"), "「" + drop.name + "」を「" + keep.name + "」に統合しました（参加記録 " + res.moved + "件を移動" +
        (res.dropped ? "・同じイベントで重複していた " + res.dropped + "件は「" + keep.name + "」側を残しました" : "") + "）", true);
    }
    $("simDetails").open = true;
    commit();
  });

  on("notSameAddBtn", "click", function() {
    var a = findUserByName($("notSameA").value.trim()), b = findUserByName($("notSameB").value.trim());
    if (!a || !b) { setMsg($("userMsg"), "2人とも登録済みユーザーの名前を入れてください（候補から選べます）", false); return; }
    if (a.id === b.id) { setMsg($("userMsg"), "同じ人です（旧名も含めて同じユーザーになっています）", false); return; }
    var key = pairKey(a.id, b.id);
    if (state.notSame.indexOf(key) >= 0) { setMsg($("userMsg"), "「" + a.name + "」と「" + b.name + "」はすでに別人リストにあります", false); return; }
    state.notSame.push(key);
    $("notSameA").value = ""; $("notSameB").value = "";
    $("notSameDetails").open = true;
    setMsg($("userMsg"), "「" + a.name + "」と「" + b.name + "」を別人リストに追加しました", true);
    commit();
  });

  on("notSameList", "click", function(e) {
    var btn = e.target.closest("button[data-unpair]");
    if (!btn) return;
    state.notSame = state.notSame.filter(function(p) { return p !== btn.dataset.unpair; });
    $("notSameDetails").open = true;
    setMsg($("userMsg"), "別人リストから外しました（似た名前の候補にまた出るようになります）", true);
    commit();
  });

  // ---------- まとめて登録 ----------
  // 各行のユーザー判定: exact=既存と一致 / aiSame=登録者がAI上で同一人物と確認済み /
  //                     similar=似た名前あり（要選択） / new=新規
  function classifyRows(parsed) {
    parsed.rows.forEach(function(r) {
      var u = findUserByName(r.name);
      if (u) { r.status = "exact"; r.matchUserId = u.id; return; }
      var same = r.sameAs && findUserByName(r.sameAs);
      if (same) {
        // 登録者の判断を初期値にする（名前は新しい名前に更新）。管理者は確認表で変更できる
        r.status = "aiSame";
        r.matchUserId = same.id;
        r.renameUser = true;
        r.cands = [{ u: same, s: 0 }].concat(similarUsers(r.name).filter(function(c) { return c.u.id !== same.id; }));
        r.defaultChoice = same.id + "|rename";
        return;
      }
      r.cands = similarUsers(r.name);
      r.status = r.cands.length ? "similar" : "new";
      // 全角半角・大文字小文字だけの違いは同一人物（名前はそのまま）を初期値にする
      r.defaultChoice = r.cands.length && r.cands[0].s === 0 ? r.cands[0].u.id + "|keep" : "";
    });
    return parsed;
  }

  function decisionCell(r, i) {
    if (r.status === "exact") {
      var u = userById(r.matchUserId);
      return '既存' + (u && nameKey(u.name) !== nameKey(r.name) ? '（「' + escapeHtml(u.name) + '」の旧名）' : "");
    }
    if (r.status === "new") return '<span class="tag new">新規ユーザー</span>';
    var prefix = r.status === "aiSame" ? '<div class="alias">登録者が同一人物と回答</div>' : "";
    var opts = ['<option value="">新規ユーザーとして登録</option>'];
    r.cands.forEach(function(c) {
      var label = "「" + c.u.name + "」（" + (c.u.alliance || "同盟なし") + "）と同一人物";
      opts.push('<option value="' + c.u.id + '|rename">' + escapeHtml(label + "・名前を「" + r.name + "」に更新") + '</option>');
      opts.push('<option value="' + c.u.id + '|keep">' + escapeHtml(label + "・名前は「" + c.u.name + "」のまま") + '</option>');
    });
    return prefix + '<select class="decide" data-i="' + i + '">' + opts.join("").replace('value="' + r.defaultChoice + '"', 'value="' + r.defaultChoice + '" selected') + '</select>';
  }

  // 確認表のプルダウンで選んだ判定を各行に反映
  function applyDecisions(parsed) {
    document.querySelectorAll("#previewBody select.decide").forEach(function(sel) {
      var r = parsed.rows[Number(sel.dataset.i)];
      if (!r) return;
      if (sel.value) {
        var v = sel.value.split("|");
        r.matchUserId = v[0];
        r.renameUser = v[1] === "rename";
      } else {
        r.matchUserId = null;
      }
    });
  }

  // ---------- 遺跡争奪の募集フォーマット ----------
  // Discordでの募集の形（2026-11-07ユーザー提供）：
  //   10/30遺跡
  //   23時:3号要塞集結早撃ち勝負        ← 時間の行より前の行はメモ（読み飛ばす）
  //   18時(4)：もち、あっきぃ、イッチー△、  ← (4)はその時間の対象の数（省略可）。名前の後ろの△＝行けるかも
  // 書かれている時間について、名前があれば参加（△なら行けるかも）、無ければ不参加。書かれていない時間は今の回答のまま
  var RUIN_LINE_RE = /^\s*(\d{1,2})\s*時\s*(?:[（(]\s*\d+\s*[)）])?\s*(?:・\s*\d+\s*人)?\s*[：:]\s*(.*)$/;
  function ruinSlotKey(hour) { var h = Number(hour); return String(h <= 6 ? h + 24 : h); } // 「1時」＝25（翌1時）
  function looksLikeRuinFormat(text) {
    return text.split(/\r?\n/).some(function(l) { var m = l.match(RUIN_LINE_RE); return m && RUIN_SLOTS.indexOf(ruinSlotKey(m[1])) >= 0; });
  }

  function parseRuinFormat(text, defaultAlliance) {
    var lines = text.split(/\r?\n/), times = [], byName = {}, order = [], errors = [];
    // 「18時(4)：」のように対象の数が付いた行が1つでもあれば、数の無い時間の行（例「23時:3号要塞集結早撃ち勝負」）はメモとして読み飛ばす
    var COUNT_RE = /^\s*\d{1,2}\s*時\s*[（(]\s*\d+\s*[)）]/;
    var hasCount = lines.some(function(l) { return COUNT_RE.test(l); });
    lines.forEach(function(line, i) {
      var m = line.match(RUIN_LINE_RE);
      if (!m || (hasCount && !COUNT_RE.test(line))) return;
      var k = ruinSlotKey(m[1]);
      if (RUIN_SLOTS.indexOf(k) < 0) { errors.push((i + 1) + "行目: " + m[1] + "時は遺跡争奪の時間（" + RUIN_SLOTS.map(slotLabel).join("・") + "）ではありません"); return; }
      if (times.indexOf(k) < 0) times.push(k);
      m[2].split(/[、,，]/).forEach(function(part) {
        var name = part.trim(), maybe = /[△▲▵∆Δ]$/.test(name);
        name = name.replace(/[△▲▵∆Δ]+$/, "").trim();
        if (!name) return;
        if (!byName[name]) { byName[name] = {}; order.push(name); }
        byName[name][k] = maybe ? "maybe" : "yes";
      });
    });
    var rows = [];
    order.forEach(function(name) {
      var slots = {};
      times.forEach(function(k) { slots[k] = byName[name][k] || "no"; });
      var u = findUserByName(name);
      var alliance = (u && u.alliance) || defaultAlliance;
      if (!alliance) { errors.push("「" + name + "」: 同盟が分かりません（初めての人は「同盟名」欄に入れてから取り込んでください）"); return; }
      var src = { alliance: alliance, name: name, entry: "start", slots: slots };
      var r = normalizeRow(src);
      r._given = givenKeys(src);
      rows.push(r);
    });
    if (!times.length) errors.push("「12時(2)：名前、名前△、」のような時間の行が見つかりません");
    return { rows: rows, errors: errors };
  }

  function ruinFormatHeader() {
    var ev = eventById(currentEventId), d = (ev && ev.date || "").split("-");
    return (d.length === 3 ? Number(d[1]) + "/" + Number(d[2]) : "") + "遺跡";
  }
  function ruinTimeHead(k) {
    var ev = eventById(currentEventId), n = ((ev && ev.ruinTargets) || {})[k] ? ev.ruinTargets[k].length : 0;
    return k + "時" + (n ? "(" + n + ")" : "") + "：";
  }
  function ruinBlankText() { return [ruinFormatHeader()].concat(ruinTimes().map(ruinTimeHead)).join("\n"); }
  function ruinSampleText() {
    return [ruinFormatHeader(), "（メモ：狙う要塞・遺跡など。時間の行より前は読み飛ばします）"].concat(ruinTimes().map(function(k, i) {
      return ruinTimeHead(k) + ["もち、あっきぃ、はる△、", "もち△、あっきぃ、", "はる、"][i % 3];
    })).join("\n");
  }
  // 参加者一覧を募集フォーマットに戻す（参加＝名前、行けるかも＝名前△）
  function buildRuinFormatText() {
    var rows = sortRows(eventRows());
    return [ruinFormatHeader()].concat(ruinTimes().map(function(k) {
      return ruinTimeHead(k) + rows.map(function(m) {
        var v = (m.slots || {})[k];
        return v === "yes" ? m.name + "、" : v === "maybe" ? m.name + "△、" : "";
      }).join("");
    })).join("\n");
  }

  function currentBulk() {
    var text = $("bulkText").value;
    var filename = loadedFile && loadedFile.text === text ? loadedFile.name : null;
    return { text: text, parsed: classifyRows(parseBulk(text, filename)) };
  }

  function parseBulk(text, filename) {
    var trimmed = text.replace(/^\uFEFF/, "").trim();
    // AIの返答は前後に説明文がつくことがあるので、先頭だけでなく中身でもJSONか判定する
    if ((filename && /\.json$/i.test(filename)) || /^[\[{]/.test(trimmed) || /"(alliance|name)"\s*:/.test(trimmed)) {
      try {
        return parseJsonText(trimmed);
      } catch (e) {
        return { rows: [], errors: ["JSONとして読み取れませんでした（AIの出力を全部コピーできているか確認してください）: " + e.message] };
      }
    }
    if (/^\uFEFF?同盟[,\t]/.test(text) || (filename && /\.(csv|tsv)$/i.test(filename))) return parseCsv(text);
    if (isRuinEvent(currentEventId) && looksLikeRuinFormat(text)) return parseRuinFormat(text, $("defaultAlliance").value.trim());
    return parseFormatText(text, $("defaultAlliance").value.trim());
  }

  function showPreview(bulk) {
    var parsed = bulk.parsed;
    lastParsed = bulk;
    var count = { exact: 0, aiSame: 0, similar: 0, "new": 0 };
    $("previewBody").innerHTML = parsed.rows.map(function(m, i) {
      count[m.status]++;
      return '<tr' + (m.status === "similar" ? ' class="similar"' : "") + '>' + memberRowHtml(m, false) +
        '<td>' + decisionCell(m, i) + '</td></tr>';
    }).join("");
    $("previewWrap").style.display = parsed.rows.length ? "block" : "none";
    var text = (parsed.blocks > 1 ? parsed.blocks + "個のJSONから" : "") + parsed.rows.length + "人を読み取りました（既存 " + count.exact + "人・登録者が同一と回答 " + count.aiSame + "人・新規 " + count["new"] + "人・似た名前あり " + count.similar + "人）";
    if (count.similar) text += "\n黄色の行は「ユーザー判定」で新規か同一人物かを選んでから「取り込み」を押してください";
    if (parsed.errors.length) text += "\n読み取れなかった行: " + parsed.errors.join(" / ");
    setMsg($("bulkMsg"), text, !parsed.errors.length);
  }

  function importRows(parsed) {
    var mode = document.querySelector("input[name=importMode]:checked").value;
    if (!parsed.rows.length) {
      setMsg($("bulkMsg"), "取り込めるデータがありません" + (parsed.errors.length ? "\n" + parsed.errors.join(" / ") : ""), false);
      return false;
    }
    var prevByUser = {};
    if (mode === "replace") {
      var n = state.entries.filter(function(x) { return x.eventId === currentEventId; }).length;
      if (!confirm("このイベントの参加者" + n + "人を外して、" + parsed.rows.length + "人で置き換えます。よろしいですか？（ユーザー一覧は残ります。取り込みに入っていない項目は、残る人の今の値を引き継ぎます）")) return false;
      state.entries.forEach(function(x) { if (x.eventId === currentEventId) prevByUser[x.userId] = x; });
      state.entries = state.entries.filter(function(x) { return x.eventId !== currentEventId; });
      resetForm(false);
    }
    var added = 0, updated = 0, newUsers = 0;
    parsed.rows.forEach(function(r) {
      var res = upsertEntry(r, prevByUser);
      if (res.result === "added") added++; else updated++;
      if (res.newUser) newUsers++;
    });
    commit();
    var text = "追加 " + added + "人・更新 " + updated + "人（うち新規ユーザー " + newUsers + "人）";
    if (parsed.errors.length) text += "\n読み取れなかった行: " + parsed.errors.join(" / ");
    setMsg($("bulkMsg"), text, !parsed.errors.length);
    $("previewWrap").style.display = "none";
    lastParsed = null;
    return true;
  }

  on("previewBtn", "click", function() {
    showPreview(currentBulk());
  });

  on("bulkBtn", "click", function() {
    var bulk;
    if (lastParsed && lastParsed.text === $("bulkText").value) {
      // 確認表を表示中なら、そこで選んだユーザー判定で取り込む
      bulk = lastParsed;
      applyDecisions(bulk.parsed);
    } else {
      bulk = currentBulk();
      if (bulk.parsed.rows.some(function(r) { return r.status === "similar"; })) {
        showPreview(bulk);
        return;
      }
    }
    if (importRows(bulk.parsed)) { $("bulkText").value = ""; loadedFile = null; }
  });

  on("bulkText", "input", function() {
    if (lastParsed) { lastParsed = null; $("previewWrap").style.display = "none"; }
  });

  // ファイルは中身を貼り付け欄に入れて、確認表を表示する（取り込みは「取り込み」ボタンで）
  on("fileInput", "change", function() {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() {
      var text = String(reader.result);
      loadedFile = { name: file.name, text: text };
      $("bulkText").value = text;
      showPreview(currentBulk());
      $("fileInput").value = "";
    };
    reader.readAsText(file, "utf-8");
  });

  function copyText(text, btn) {
    var done = function() {
      var orig = btn.textContent;
      btn.textContent = "コピーしました";
      setTimeout(function() { btn.textContent = orig; }, 1500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done);
    else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); done();
    }
  }

  on("copyBlankBtn", "click", function() { copyText(isRuinEvent(currentEventId) ? ruinBlankText() : BLANK, this); });
  on("copyPromptBtn", "click", function() { copyText(buildPrompt(), this); });
  on("sampleBtn", "click", function() { $("bulkText").value = isRuinEvent(currentEventId) ? ruinSampleText() : SAMPLE; });

  // ---------- 書き出し ----------
  function download(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  on("exportJsonBtn", "click", function() {
    var data = { updated: new Date().toISOString(), users: state.users, events: state.events, entries: state.entries, notSame: state.notSame };
    download("members.json", JSON.stringify(data, null, 2) + "\n", "application/json");
  });

  on("exportCsvBtn", "click", function() {
    var ev = eventById(currentEventId);
    var lines = [CSV_COLS.map(function(c) { return c[1]; }).join(",")].concat(sortRows(eventRows()).map(function(m) {
      return CSV_COLS.map(function(c) {
        var v = m[c[0]];
        if (typeof v === "boolean") v = v ? 1 : "";
        if (c[0] === "entry") v = ENTRY_SHORT[v];
        return csvCell(v);
      }).join(",");
    }));
    download("members_" + ev.type + "_" + ev.date + ".csv", "\uFEFF" + lines.join("\r\n") + "\r\n", "text/csv");
  });

  function entryText(m) {
    var s = m.name + marksOf(m);
    var t = timeText(m), tr = troopText(m);
    if (t) s += "(" + t + ")";
    if (tr) s += "(" + tr + ")";
    // 備考内の括弧は読み取り時に別項目と誤認されるので［］に置き換える
    if (m.note) s += "(" + m.note.replace(/[(（]/g, "［").replace(/[)）]/g, "］") + ")";
    return s;
  }

  function buildFormatText() {
    if (isRuinEvent(currentEventId)) return buildRuinFormatText();
    var rows = eventRows();
    var blocks = [];
    var alliances = [];
    rows.forEach(function(m) { if (alliances.indexOf(m.alliance) < 0) alliances.push(m.alliance); });
    alliances.forEach(function(a) {
      ["start", "late"].forEach(function(entry) {
        var list = rows.filter(function(m) { return m.alliance === a && m.entry === entry; });
        if (!list.length) return;
        var lines = [a + "(" + ENTRY_LABEL[entry] + ")", LEGEND];
        GRADES.forEach(function(g) {
          var names = list.filter(function(m) { return m.grade === g; }).map(entryText);
          lines.push(g + ": " + names.map(function(n) { return n + "、"; }).join(""));
        });
        blocks.push(lines.join("\n"));
      });
    });
    return blocks.join("\n\n");
  }

  // ---------- AIに渡す用 ----------
  // 上の参加者一覧と同じ並び。絞り込み指定時は一覧の同盟・検索の絞り込みも反映する
  function aiRows() {
    var rows = sortRows(eventRows()).filter(function(m) { return m.entry !== "absent"; }); // 不参加の人はチーム分けに不要
    if (!$("aiFilteredOnly").checked) return rows;
    var q = $("filterInput").value.trim().toLowerCase(), fa = $("filterAlliance").value;
    return rows.filter(function(m) {
      return (!fa || m.alliance === fa) && (!q || (m.name + " " + m.note).toLowerCase().indexOf(q) >= 0);
    });
  }

  // 列名は日本語にして、AIが説明なしでも意味を取りやすくする
  function aiRecord(m) {
    return {
      "同盟": m.alliance, "名前": m.name, "参加": ENTRY_SHORT[m.entry], "区分": m.grade,
      "マンスリー": m.monthly, "途中抜け": m.leaveEarly, "VC": m.vc, "ビビアン星4以上": m.vivian4, "変更の可能性": m.mayChange,
      "兵種": m.troops, "T": m.tier, "参加開始": m.joinAt, "抜ける時刻": m.leaveAt, "備考": m.note,
      "出征部隊数": m.marchCount, "出征容量ペットLv": m.marchPet, "集結部隊数": m.rallyCount, "集結容量ペットLv": m.rallyPet,
      "行軍速度ペットLv": m.rallySpeedPet,
      "出征容量（計算後）": m.marchCap, "集結容量（計算後）": m.rallyCap
    };
  }

  function buildAiText() {
    var format = document.querySelector("input[name=aiFormat]:checked").value;
    var rows = aiRows();
    if (isRuinEvent(currentEventId)) return buildRuinAiText(format, rows);
    var head = [
      "# " + eventLabel(eventById(currentEventId)) + " 参加者一覧（" + rows.length + "人）",
      "",
      "## 列の意味",
      "- 同盟・名前: プレイヤーの所属同盟と名前",
      "- 参加: 最初から（開始時から参加）／途中参加（不参加と答えた人は含めていません）",
      "- 区分: G8・G7・G6・G5・その他（募集フォーマットでの区分）",
      format === "csv"
        ? "- マンスリー・途中抜け・VC・ビビアン星4以上: ◯なら該当（VC＝ボイスチャット参加可能・聴き専含む）"
        : "- マンスリー・途中抜け・VC・ビビアン星4以上: true なら該当（VC＝ボイスチャット参加可能・聴き専含む）",
      "- 変更の可能性: 登録時点で、参加時間などが変わる可能性があると本人が答えた人",
      "- 兵種: 歩＝歩兵、騎＝騎兵、弓＝弓兵（例: 歩弓＝歩兵と弓兵）。空欄は指定なし",
      "- T: 兵士レベル（大きいほど強い）。空欄は不明",
      "- 参加開始・抜ける時刻: 途中から参加する時刻／途中で抜ける時刻。空欄は指定なし",
      "- 出征部隊数・出征容量ペットLv: 出せる部隊の数と、出征容量を上げるペットのレベル（全員が登録）",
      "- 集結部隊数・集結容量ペットLv・行軍速度ペットLv: 集結の部隊の数と、集結容量・行軍速度を上げるペットのレベル（集結の指示があった人だけ登録。空欄は対象外）",
      "- ペットLvの効果（0は持っていない）: 出征容量ペット Lv×1,500（最大Lv10で+15,000）／集結容量ペット 50,000＋Lv×10,000（Lv1で+60,000、最大Lv10で+150,000）／行軍速度ペット Lv1で+15%・Lv7まで1つ上がるごとに+2%（Lv7で+27%）・最大Lv8で+30%",
      "- 出征部隊数・集結部隊数: ペットのスキルやバフがない状態で、野獣に1軍で攻撃（集結攻撃）したときの数",
      "- 出征容量（計算後）・集結容量（計算後）: 上の部隊数にスキルとバフを加えた容量。計算の条件: " + CAP_RULE,
      "",
      "## データ（" + (format === "csv" ? "CSV" : "JSON") + "）"
    ];
    var body;
    if (format === "csv") {
      var cols = ["同盟", "名前", "参加", "区分", "マンスリー", "途中抜け", "VC", "ビビアン星4以上", "変更の可能性", "兵種", "T", "参加開始", "抜ける時刻", "備考",
        "出征部隊数", "出征容量ペットLv", "集結部隊数", "集結容量ペットLv", "行軍速度ペットLv", "出征容量（計算後）", "集結容量（計算後）"];
      body = [cols.join(",")].concat(rows.map(function(m) {
        var r = aiRecord(m);
        return cols.map(function(c) {
          var v = r[c];
          if (typeof v === "boolean") v = v ? "◯" : "";
          return csvCell(v == null ? "" : v);
        }).join(",");
      })).join("\n");
    } else {
      body = JSON.stringify(rows.map(aiRecord), null, 1);
    }
    return head.join("\n") + "\n" + FENCE + (format === "csv" ? "csv" : "json") + "\n" + body + "\n" + FENCE + "\n";
  }

  // 遺跡争奪：時間ごとの参加（◯参加／△行けるかも／×不参加）だけを渡す（区分・部隊数・ペットは登録しないため）
  function buildRuinAiText(format, rows) {
    var times = ruinTimes();
    var cols = ["同盟", "名前"].concat(times.map(slotLabel), ["備考"]);
    var recs = rows.map(function(m) {
      var r = { "同盟": m.alliance, "名前": m.name };
      times.forEach(function(k) { r[slotLabel(k)] = SLOT_MARK[(m.slots || {})[k]] || ""; });
      r["備考"] = m.note;
      return r;
    });
    var head = [
      "# " + eventLabel(eventById(currentEventId)) + " 参加者一覧（" + rows.length + "人）",
      "",
      "## 列の意味",
      "- 同盟・名前: プレイヤーの所属同盟と名前",
      "- " + times.map(slotLabel).join("・") + ": その時間の遺跡争奪に ◯＝参加／△＝行けるかも／×＝不参加（空欄は未回答）",
      "- 全部の時間が×の人（不参加）は含めていません",
      "",
      "## データ（" + (format === "csv" ? "CSV" : "JSON") + "）"
    ];
    var body = format === "csv"
      ? [cols.join(",")].concat(recs.map(function(r) { return cols.map(function(c) { return csvCell(r[c] == null ? "" : r[c]); }).join(","); })).join("\n")
      : JSON.stringify(recs, null, 1);
    return head.join("\n") + "\n" + FENCE + (format === "csv" ? "csv" : "json") + "\n" + body + "\n" + FENCE + "\n";
  }

  function refreshAiText() {
    if (!$("aiOut")) return "";
    var text = buildAiText();
    $("aiOut").value = text;
    $("aiInfo").textContent = aiRows().length + "人・約" + text.length.toLocaleString() + "文字";
    return text;
  }

  // ---------- 個人登録の記録 ----------
  var logRows = [];
  var LOG_ACT = { added: "登録", updated: "変更", canceled: "取消", blocked: "ブロック", reverted: "元に戻した（管理者）" };
  var blocklist = [];

  function ipBlocked(ip) {
    return !!ip && blocklist.some(function(b) {
      return b.ip.slice(-1) === "*" ? ip.indexOf(b.ip.slice(0, -1)) === 0 : ip === b.ip;
    });
  }

  // いたずらっぽい動きの自動チェック（記録は新しい順）
  //   ・同じIPから3人以上の名前で登録・変更している
  //   ・前に登録したときと違うIPから、その人の登録が変更・取消された（他人の登録を触った可能性）
  function watchItems() {
    var byIp = {}, items = [];
    logRows.forEach(function(r) {
      if (!r.ip || r.act === "blocked") return;
      (byIp[r.ip] = byIp[r.ip] || {})[r.uid || r.name] = r.name;
    });
    Object.keys(byIp).forEach(function(ip) {
      var names = Object.keys(byIp[ip]).map(function(k) { return byIp[ip][k]; });
      if (names.length >= 3) items.push({ ip: ip, text: "IP " + ip + " から " + names.length + "人分の登録・変更（" + names.join("、") + "）" });
    });
    var firstIp = {};
    logRows.slice().reverse().forEach(function(r) {
      if (!r.ip || !r.uid || r.act === "blocked") return;
      if (!firstIp[r.uid]) { firstIp[r.uid] = r.ip; return; }
      if (r.ip !== firstIp[r.uid] && r.act !== "added") {
        items.push({ ip: r.ip, text: formatTime(r.t) + "「" + r.name + "」の登録が、最初と違うIP " + r.ip + " から" + (LOG_ACT[r.act] || r.act) + "されました（最初は " + firstIp[r.uid] + "）" + (r.by ? "。代理: " + r.by : "") });
      }
    });
    return items;
  }

  function renderBlocklist() {
    if (!$("blockList")) return;
    $("blockList").innerHTML = blocklist.map(function(b, i) {
      return '<div class="block-row"><b>' + escapeHtml(b.ip) + '</b><span class="hint">' + escapeHtml(b.note || "") +
        (b.at ? "（" + escapeHtml(formatTime(b.at)) + "〜）" : "") + '</span><button type="button" class="small sub-btn" data-unblock="' + i + '">解除</button></div>';
    }).join("") || '<div class="hint">ブロック中のIPはありません</div>';
  }

  function saveBlocklist(list, msg) {
    $("logInfo").textContent = "保存中…";
    return gasCall({ action: "setBlocklist", list: list }).then(function(res) {
      if (!res.ok) throw new Error(res.error || "保存できませんでした");
      blocklist = res.blocklist || [];
      renderBlocklist();
      renderLog();
      $("logInfo").textContent = msg;
    }).catch(function(e) {
      $("logInfo").textContent = "保存できませんでした: " + e.message;
    });
  }

  function blockIp(ip, note) {
    ip = String(ip || "").trim();
    if (!ip) return;
    if (blocklist.some(function(b) { return b.ip === ip; })) { $("logInfo").textContent = ip + " はすでにブロック中です"; return; }
    if (!confirm(ip + " からの個人登録をブロックします。よろしいですか？")) return;
    saveBlocklist(blocklist.concat([{ ip: ip, note: note || "", at: new Date().toISOString() }]), ip + " をブロックしました");
  }

  function renderLog() {
    if (!$("logBody")) return;
    var q = $("logFilter").value.trim().toLowerCase();
    var rows = logRows.filter(function(r) {
      return !q || [r.name, r.by, r.ip, r.ev].join(" ").toLowerCase().indexOf(q) >= 0;
    });
    $("logInfo").textContent = logRows.length ? (q ? rows.length + " / " : "") + logRows.length + "件" : "";
    $("logBody").innerHTML = rows.map(function(r) {
      var blocked = ipBlocked(r.ip);
      return '<tr' + (blocked ? ' class="blocked"' : "") + "><td style=\"white-space: nowrap;\">" + escapeHtml(formatTime(r.t)) + "</td><td>" + escapeHtml(r.ev || "") +
        "</td><td>" + escapeHtml(r.name || "") + (r.by ? '<br><span class="hint">（代理: ' + escapeHtml(r.by) + "）</span>" : "") +
        "</td><td>" + escapeHtml(LOG_ACT[r.act] || r.act || "") +
        "</td><td style=\"white-space: nowrap;\">" + escapeHtml(r.ip || "（不明）") +
        (r.ip && !blocked ? ' <button type="button" class="small danger" data-block="' + escapeHtml(r.ip) + '" data-name="' + escapeHtml(r.name || "") + '">ブロック</button>' : "") +
        (blocked ? ' <span class="tag new">ブロック中</span>' : "") +
        '</td><td class="hint">' + escapeHtml(r.ua || "") + "</td></tr>";
    }).join("") || '<tr><td colspan="6" class="hint">記録はまだありません</td></tr>';
    var items = watchItems();
    $("logWatch").style.display = items.length ? "block" : "none";
    $("logWatch").innerHTML = "<b>⚠ 要注意（" + items.length + "件）</b><br>" + items.map(function(it) {
      return escapeHtml(it.text) + (ipBlocked(it.ip) ? ' <span class="tag new">ブロック中</span>' :
        ' <button type="button" class="small danger" data-block="' + escapeHtml(it.ip) + '" data-name="">ブロック</button>');
    }).join("<br>");
  }

  on("logLoadBtn", "click", function() {
    $("logInfo").textContent = "読み込み中…";
    gasCall({ action: "getLog" }).then(function(res) {
      if (!res.ok) throw new Error(res.error || "読み込めませんでした");
      logRows = res.log || [];
      blocklist = res.blocklist || [];
      renderBlocklist();
      renderLog();
    }).catch(function(e) {
      $("logInfo").textContent = "読み込めませんでした: " + e.message;
    });
  });
  on("logFilter", "input", renderLog);
  on("blockAddBtn", "click", function() {
    blockIp($("blockIpInput").value, $("blockNoteInput").value.trim());
    $("blockIpInput").value = ""; $("blockNoteInput").value = "";
  });
  [$("logBody"), $("logWatch")].forEach(function(el) {
    if (!el) return;
    el.addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-block]");
      if (btn) blockIp(btn.dataset.block, btn.dataset.name ? "「" + btn.dataset.name + "」の記録から" : "要注意から");
    });
  });
  on("blockList", "click", function(e) {
    var btn = e.target.closest("button[data-unblock]");
    if (!btn) return;
    var b = blocklist[Number(btn.dataset.unblock)];
    if (!b || !confirm(b.ip + " のブロックを解除します。よろしいですか？")) return;
    saveBlocklist(blocklist.filter(function(x) { return x !== b; }), b.ip + " のブロックを解除しました");
  });

  on("aiCopyBtn", "click", function() { copyText(refreshAiText(), this); });
  document.querySelectorAll("input[name=aiFormat]").forEach(function(r) { r.addEventListener("change", refreshAiText); });
  on("aiFilteredOnly", "change", refreshAiText);

  on("formatBtn", "click", function() { $("formatOut").value = buildFormatText(); });
  on("copyFormatBtn", "click", function() {
    if (!$("formatOut").value) $("formatOut").value = buildFormatText();
    copyText($("formatOut").value, this);
  });

  on("discardBtn", "click", function() {
    if (!confirm("まだ保存していない変更を取り消して、最後に保存された状態に戻しますか？")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    resetForm(false);
    loadData();
  });
  window.addEventListener("beforeunload", function(e) {
    if (publishedJson && serialize() !== publishedJson) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- 起動 ----------
  if (isAuthed()) showApp();
  else $("pwInput").focus();
})();
