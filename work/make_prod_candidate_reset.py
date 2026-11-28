import sys
from pathlib import Path
prod, work, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
raw = prod.read_bytes().decode("utf-8"); crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
w = work.read_bytes().decode("utf-8").replace("\r\n", "\n")
a = '    if (p.action === "userImportUndo") return json_(userImportUndo_(token, p));'
assert s.count(a) == 1, "本番コードに userImportUndo のハンドラがありません（先に取り込み機能を反映してください）"
s = s.replace(a, a + '\n    // データの全リセット・バックアップ一覧・復元（管理者のみ）\n    if (p.action === "dataResetAll") return json_(dataResetAll_(token, p));\n    if (p.action === "dataBackupList") return json_(dataBackupList_());\n    if (p.action === "dataRestore") return json_(dataRestore_(token, p));')
i = w.index("// ---------- データの全リセット・復元"); j = w.index("// 以前 GAS で作り直していたときのトリガーの後始末")
m = "// 以前 GAS で作り直していたときのトリガーの後始末"
assert s.count(m) == 1
s = s.replace(m, w[i:j] + m)
out.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("ok")
