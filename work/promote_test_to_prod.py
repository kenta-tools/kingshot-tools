"""test/ の中身を本番側のパスへ昇格する（除外リスト付き・ドライラン付き）。昇格のたびに使えます。

使い方（リポジトリのルートで）:
  python work/promote_test_to_prod.py            … ドライラン（何も書き換えない。コピーされるファイルと差分の行数を表示）
  python work/promote_test_to_prod.py --apply    … 実際にコピーする（git の変更として残るので、確認してからコミット・push）
  python work/promote_test_to_prod.py --verify   … 本番側のファイルに、test用の設定（testのGAS・test環境の目印）が混ざっていないかだけ確認

昇格しないもの（EXCLUDE）:
  config.js              … test専用（テストのGAS・保存キーの分離・オレンジ帯）。ただし「ホイールで値が変わらない」コードだけは本番の config.js に追記する
  index.html（TOP）      … test用の注意書き・「（テスト）」見出し。本番のTOPは別に管理
  spec/                  … 仕様まとめは本番側の spec/spec.md を直接更新する
  flame-dragon/ holy-sword-league/ kvk-matchup/ … GitHub Actions が自動生成するページ（testのコピーは古いので上書きしない）
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST = ROOT / "test"
EXCLUDE_FILES = {"config.js", "index.html"}
EXCLUDE_DIRS = {"spec", "flame-dragon", "holy-sword-league", "kvk-matchup"}
# 本番に混ざってはいけないもの（test環境の設定）
FORBIDDEN = ["AKfycbztnub9", "IS_TEST_ENV", "PROD_GAS_URL", "this is a test mirror"]
PROD_GAS_ID = "AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw"
WHEEL_MARK = "全ページ共通：マウスホイールでプルダウン"


def read(p):
    return p.read_bytes()


def lines(b):
    return b.decode("utf-8", "replace").replace("\r\n", "\n").split("\n")


def diff_counts(old, new):
    import difflib
    add = rem = 0
    for l in difflib.unified_diff(lines(old), lines(new), lineterm="", n=0):
        if l.startswith("+++") or l.startswith("---") or l.startswith("@@"):
            continue
        if l.startswith("+"):
            add += 1
        elif l.startswith("-"):
            rem += 1
    return add, rem


def targets():
    out = []
    for dp, dn, fn in os.walk(TEST):
        rel_dir = Path(dp).relative_to(TEST)
        parts = rel_dir.parts
        if parts and parts[0] in EXCLUDE_DIRS:
            dn[:] = []
            continue
        for f in fn:
            rel = rel_dir / f
            if len(rel.parts) == 1 and rel.name in EXCLUDE_FILES:
                continue
            out.append(rel)
    return sorted(out)


def wheel_block():
    src = read(TEST / "config.js").decode("utf-8").replace("\r\n", "\n")
    i = src.find("// " + WHEEL_MARK)
    if i < 0:
        return None
    return src[i:].rstrip("\n") + "\n"


def forbidden_in(b):
    t = b.decode("utf-8", "replace")
    return [w for w in FORBIDDEN if w in t]


def verify():
    bad = []
    for dp, dn, fn in os.walk(ROOT):
        rel = Path(dp).relative_to(ROOT)
        if rel.parts and rel.parts[0] in {"test", ".git", "work", "node_modules"}:
            dn[:] = []
            continue
        for f in fn:
            if not f.endswith((".html", ".js")):
                continue
            p = Path(dp) / f
            hit = forbidden_in(read(p))
            if str(rel / f) == "index.html":  # 本番TOPは「test環境のときだけ」使うコードを持つ（本番では動かない）。testのGASのIDだけ確認する
                hit = [w for w in hit if w not in ("IS_TEST_ENV", "PROD_GAS_URL")]
            if hit:
                bad.append((str(rel / f), hit))
    cfg = (ROOT / "config.js").read_text(encoding="utf-8")
    if PROD_GAS_ID not in cfg:
        bad.append(("config.js", ["本番のGAS_URLがありません"]))
    return bad


def main():
    apply = "--apply" in sys.argv
    if "--verify" in sys.argv:
        bad = verify()
        for b in bad:
            print("NG ", b[0], b[1])
        print("本番側にtest用の設定は混ざっていません" if not bad else "上のファイルを確認してください")
        sys.exit(1 if bad else 0)

    changed, new, same, skipped, tot_add, tot_rem = [], [], 0, [], 0, 0
    for rel in targets():
        t = TEST / rel
        p = ROOT / rel
        tb = read(t)
        hit = forbidden_in(tb)
        if hit:
            skipped.append((str(rel), hit))
            continue
        if not p.exists():
            a, r = diff_counts(b"", tb)
            new.append((str(rel), a, r))
        else:
            pb = read(p)
            if pb.replace(b"\r\n", b"\n") == tb.replace(b"\r\n", b"\n"):
                same += 1
                continue
            a, r = diff_counts(pb, tb)
            changed.append((str(rel), a, r))
        tot_add += a
        tot_rem += r
        if apply:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(tb)

    print("== 昇格（%s）==" % ("実行" if apply else "ドライラン"))
    for name, a, r in changed:
        print("変更  +%-4d -%-4d %s" % (a, r, name))
    for name, a, r in new:
        print("新規  +%-4d        %s" % (a, name))
    print("同じ（コピー不要）: %d ファイル" % same)
    for name, hit in skipped:
        print("スキップ（test用の設定が含まれる）: %s %s" % (name, hit))

    # config.js：ホイール無効のコードだけ追記
    wb = wheel_block()
    cfgp = ROOT / "config.js"
    cfg = cfgp.read_bytes().decode("utf-8")
    nl = "\r\n" if "\r\n" in cfg else "\n"
    if wb and WHEEL_MARK not in cfg:
        print("config.js: ホイール無効のコードを追記（+%d行）" % len(wb.split("\n")))
        tot_add += len(wb.split("\n"))
        if apply:
            cfgp.write_bytes((cfg.rstrip("\r\n") + nl + nl + wb.replace("\n", nl)).encode("utf-8"))
    else:
        print("config.js: ホイール無効のコードは追記済み／対象なし")
    print("合計: 変更 %d・新規 %d ファイル（+%d行 -%d行）%s" % (len(changed), len(new), tot_add, tot_rem, "" if apply else "（まだ何も書き換えていません。--apply で実行）"))
    if apply:
        bad = verify()
        for b in bad:
            print("NG ", b[0], b[1])
        print("確認: 本番側にtest用の設定は混ざっていません" if not bad else "上のファイルを確認してください")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
