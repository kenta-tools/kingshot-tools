import sys
from pathlib import Path
prod, work, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
raw = prod.read_bytes().decode("utf-8"); crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
w = work.read_bytes().decode("utf-8").replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, ("本番コードに見つからない/複数", a[:60], s.count(a)); s = s.replace(a, b)
# 1) ハンドラ
rep('    if (p.action === "setBlocklist")', '''    // 816ユーザーの取り込み（管理者のみ）
    if (p.action === "userImportPendingSet") return json_(userImportPendingSet_(token, p));
    if (p.action === "userImportInfo") return json_(userImportInfo_(token));
    if (p.action === "userImportPreview") return json_(userImportPreview_(token, p));
    if (p.action === "userImportCommit") return json_(userImportCommit_(token, p));
    if (p.action === "userImportUndo") return json_(userImportUndo_(token, p));
    if (p.action === "setBlocklist")''')
# 2) pubGet の gid
rep('users: (d.users || []).map(function(u) { return { id: u.id, name: u.name, alliance: u.alliance, aliases: u.aliases || [] }; }),',
    'users: (d.users || []).map(function(u) { var o = { id: u.id, name: u.name, alliance: u.alliance, aliases: u.aliases || [] }; if (u.gid) o.gid = u.gid; return o; }), // gid（ゲーム内ID）は公開（2026-11-12 ユーザー指示）')
# 3) put の gid 保護
rep('''        return json_(writeFile_(token, data, p.sha, "admin"));''', '''        // 古い管理画面（gidを知らない）で保存されても、すでに付いている gid・source を消さない
        var cur = readFile_(token);
        if (cur.ok) {
          var curBy = {};
          (cur.data.users || []).forEach(function(u) { curBy[u.id] = u; });
          data.users.forEach(function(u) {
            var c = curBy[u.id];
            if (c && c.gid && !u.gid) { u.gid = c.gid; if (c.source) u.source = c.source; if (c.importedAt) u.importedAt = c.importedAt; }
          });
          if (cur.data.userImports && !data.userImports) data.userImports = cur.data.userImports;
          if (cur.data.userImportPending && !data.userImportPending) data.userImportPending = cur.data.userImportPending;
        }
        return json_(writeFile_(token, data, p.sha, "admin"));''')
# 4) 取り込み機能の本体
i = w.index("// ---------- 816ユーザーの取り込み"); j = w.index("// 以前 GAS で作り直していたときのトリガーの後始末")
block = w[i:j]
rep("// 以前 GAS で作り直していたときのトリガーの後始末", block + "// 以前 GAS で作り直していたときのトリガーの後始末")
out.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("ok")
