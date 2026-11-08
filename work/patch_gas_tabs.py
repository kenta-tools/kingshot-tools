import sys, re
from pathlib import Path
p = Path(sys.argv[1])
raw = p.read_bytes().decode("utf-8"); crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)

rep("var KVK_MAX_TABS = 10;", "var KVK_MAX_TABS = 11; // 「設定」タブ＋名簿タブ10個\nvar KVK_SITES = [\"castle\", \"north\", \"east\", \"south\", \"west\"]; // 王城・北砲台・東砲台・南砲台・西砲台")
rep("// 1件: { eventId, rows（＝最初のタブの名簿。古い画面との互換用）, updatedAt, tabs: [{id, title, matchupId, rows, updatedAt}, ...] }\n// 昔の形（tabsなし）は、tabs=[{id:\"main\", title:\"標準\", rows}] として扱う（保存し直さなくてよい）。",
    "// 1件: { eventId, rows（＝最初のタブ＝設定の行。古い画面との互換用）, updatedAt, tabs: [{id, title, kind, site, matchupId, rows, updatedAt}, ...] }\n// 2026-11-08 タブの作り直し：tabs[0] は必ず kind:\"settings\"（id \"settings\"・左端固定・複製/削除/名前変更/移動不可）。ほかは kind:\"tab\"（拠点 site を選び、設定の行を id で参照する）。\n// 設定の行: {id,name,plain{拠点:秒|null},petOv{拠点:秒|null},adj,petLevel,group,opponentName,opponentSec} ／ 名簿タブの行: {id(設定の行のid),usePet,own,ownSec}\n// 昔の形（settingsタブが無い）は読まずに、設定＋名簿1の新しい形として扱う（旧データの変換はしない）。")
# kvkRows_ 置き換え
i = s.index("function kvkRows_(rows) {"); j = s.index("// 保存データの1件から、タブの一覧を取り出す")
new_rows = '''function kvkSiteMap_(src, round) {
  var o = {};
  KVK_SITES.forEach(function(k) {
    var v = src ? numOrNull_(src[k]) : null;
    if (v !== null && round) v = Math.round(v);
    o[k] = v;
  });
  return o;
}

// 設定タブの行
function kvkSettingsRows_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 500).map(function(r) {
    return {
      id: clip_(r.id, 24),
      name: clip_(r.name, 30),
      plain: kvkSiteMap_(r.plain, false),
      petOv: kvkSiteMap_(r.petOv, true),
      adj: numOrNull_(r.adj) || 0, // 遅延秒数
      petLevel: count_(r.petLevel, 8) || 0,
      group: clip_(r.group, 20),
      opponentName: clip_(r.opponentName, 30),
      opponentSec: numOrNull_(r.opponentSec)
    };
  }).filter(function(r) { return r.name && r.id; });
}

// 名簿タブの行（設定の行を id で参照する）
function kvkTabRows_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 500).map(function(r) {
    var os = numOrNull_(r.own === true ? r.ownSec : null);
    return { id: clip_(r.id, 24), usePet: r.usePet !== false, own: r.own === true, ownSec: os === null ? (r.own === true && numOrNull_(r.ownSec) !== null ? Math.round(numOrNull_(r.ownSec)) : null) : Math.round(os) };
  }).filter(function(r) { return r.id; });
}

function kvkRowsFor_(kind, rows) { return kind === "settings" ? kvkSettingsRows_(rows) : kvkTabRows_(rows); }

function kvkDefaultTabs_() {
  return [
    { id: "settings", title: "設定", kind: "settings", site: "", matchupId: "", rows: [], updatedAt: "" },
    { id: "main", title: "名簿1", kind: "tab", site: "castle", matchupId: "", rows: [], updatedAt: "" }
  ];
}

'''
s = s[:i] + new_rows + s[j:]
# kvkTabsOf_
i = s.index("function kvkTabsOf_(rec) {"); j = s.index("// pubGet で返す形")
new_tabsof = '''function kvkTabsOf_(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.tabs) && rec.tabs.length && rec.tabs[0].kind === "settings") {
    return rec.tabs.map(function(t) {
      var settings = t.kind === "settings";
      return { id: t.id, title: settings ? "設定" : (t.title || "名簿"), kind: settings ? "settings" : "tab",
        site: settings ? "" : (KVK_SITES.indexOf(t.site) >= 0 ? t.site : "castle"),
        matchupId: t.matchupId || "", rows: t.rows || [], updatedAt: t.updatedAt || "" };
    });
  }
  return kvkDefaultTabs_(); // 昔の形：新しい形（設定＋名簿1）として扱う。保存されるまで元のデータは触らない
}

'''
s = s[:i] + new_tabsof + s[j:]
# kvkSave_
rep("  var rows = kvkRows_(p.rows);\n\n  var lock", "\n  var lock")
rep("      if (!tabs.length) tabs = [{ id: \"main\", title: \"標準\", matchupId: \"\", rows: [], updatedAt: \"\" }];\n      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : tabs[0];",
    "      if (!tabs.length) tabs = kvkDefaultTabs_();\n      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : tabs[0];")
rep("      tab.rows = rows;\n      tab.updatedAt", "      tab.rows = kvkRowsFor_(tab.kind, p.rows);\n      tab.updatedAt")
# kvkTabs_
rep("      if (!tabs.length) tabs = [{ id: \"main\", title: \"標準\", matchupId: \"\", rows: [], updatedAt: \"\" }];\n      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : null;",
    "      if (!tabs.length) tabs = kvkDefaultTabs_();\n      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : null;\n      // 設定タブは、複製（kind:settingsの追加）・名前変更・削除・移動を受け付けない\n      if (tab && tab.kind === \"settings\" && (op === \"rename\" || op === \"delete\" || op === \"setSite\")) return { ok: false, status: 400, error: \"設定タブは変更できません\" };")
rep("        if (tabs.length >= KVK_MAX_TABS) return { ok: false, status: 400, error: \"タブは1イベントに\" + KVK_MAX_TABS + \"個までです\" };\n        var title = clip_(p.title, 20) || \"名簿\" + (tabs.length + 1);\n        var nt = { id: \"t\" + Utilities.getUuid().replace(/-/g, \"\").slice(0, 8), title: title, matchupId: clip_(p.matchupId, 40),\n          rows: kvkRows_(p.rows), updatedAt: new Date().toISOString() };",
    "        if (p.kind === \"settings\") return { ok: false, status: 400, error: \"設定タブは追加・複製できません\" };\n        if (tabs.length >= KVK_MAX_TABS) return { ok: false, status: 400, error: \"タブは「設定」のほかに\" + (KVK_MAX_TABS - 1) + \"個までです\" };\n        var title = clip_(p.title, 20) || \"名簿\" + tabs.length;\n        var nt = { id: \"t\" + Utilities.getUuid().replace(/-/g, \"\").slice(0, 8), title: title, kind: \"tab\", site: KVK_SITES.indexOf(p.site) >= 0 ? p.site : \"castle\", matchupId: clip_(p.matchupId, 40),\n          rows: kvkTabRows_(p.rows), updatedAt: new Date().toISOString() };")
rep("      } else if (op === \"setMatchup\") {", "      } else if (op === \"setSite\") {\n        if (!tab) return { ok: false, status: 404, error: \"そのタブが見つかりません\" };\n        if (KVK_SITES.indexOf(p.site) < 0) return { ok: false, status: 400, error: \"拠点が正しくありません\" };\n        tab.site = p.site;\n      } else if (op === \"setMatchup\") {")
rep("        tabs.forEach(function(t) { if (byId[t.id]) next.push(t); }); // 指定に無かったタブは末尾へ（他の人が追加したタブを消さない）\n        tabs = next;",
    "        tabs.forEach(function(t) { if (byId[t.id]) next.push(t); }); // 指定に無かったタブは末尾へ（他の人が追加したタブを消さない）\n        // 設定タブは常に左端\n        var st = next.filter(function(t) { return t.kind === \"settings\"; })[0];\n        if (st) { next.splice(next.indexOf(st), 1); next.unshift(st); }\n        tabs = next;")
rep("        if (tabs.length <= 1) return { ok: false, status: 400, error: \"最後の1つのタブは削除できません\" };", "        if (tabs.length <= 2) return { ok: false, status: 400, error: \"名簿タブは最後の1つを削除できません\" };")
p.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("patched", p)
