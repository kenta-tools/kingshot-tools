from pathlib import Path
p = Path("work/gas_members_proxy.gs")
raw = p.read_bytes().decode("utf-8"); crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]; s = s.replace(a, b)
rep("""    else if (it.kind === "new") act = "create";
    else act = "skip"; // review・noalliance は選ばれていなければ飛ばす""",
"""    else if (it.kind === "new") act = "create";
    else if (it.kind === "noalliance" && (opts.includeNoAlliance === true || (Array.isArray(opts.noAllianceGids) && opts.noAllianceGids.indexOf(it.gid) >= 0))) act = "create"; // 同盟なし：選んだ人（または全員）だけ登録
    else act = "skip"; // 要確認・同盟なしは、選ばれていなければ飛ばす（同名の別人は決定で createSuffixed を選べば作れる）""")
rep("""      it.newName = act === "createSuffixed" ? clip_(it.name, 20) + "(" + it.gid + ")" : it.name;
      var tk = normName_(it.newName);""",
"""      it.newName = it.name;
      if (act === "createSuffixed") { // 名前(gid末尾4桁)。それでも重なるときは gid 全部
        it.newName = clip_(it.name, 22) + "(" + it.gid.slice(-4) + ")";
        if (takenName[normName_(it.newName)]) it.newName = clip_(it.name, 8) + "(" + it.gid + ")";
      }
      var tk = normName_(it.newName);""")
rep("""  var plan = userImportPlan_(f.data, rows, p);
  return { ok: true, items: plan.items, total: plan.total, topN: plan.topN, counts: userImportCounts_(plan.items), sha: f.sha };""",
"""  var plan = userImportPlan_(f.data, rows, p);
  var pd = f.data.userImportPending || {};
  var res = { ok: true, total: plan.total, topN: plan.topN, counts: userImportCounts_(plan.items), sha: f.sha,
    coverage: { fetched: rows.length, playerCount: pd.playerCount == null ? null : pd.playerCount, fetchedAt: pd.fetchedAt || "", notes: pd.notes || [] } };
  if (!p.countsOnly) res.items = plan.items; // 名前・gid の一覧（管理者の画面用。Actions のログには出さない）
  return res;""")
rep("""    var plan = userImportPlan_(d, rows, p);
    var now = new Date().toISOString();
    var rec = { id""", """    var plan = userImportPlan_(d, rows, p);
    var now = new Date().toISOString();
    // 取り込み前の状態に戻せるように、データファイルを丸ごとコピーして残す（非公開のGoogleドライブ）
    var backupName = "members_backup_pre-import_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss") + ".json";
    DriveApp.getFileById(PropertiesService.getScriptProperties().getProperty("DATA_FILE_ID")).makeCopy(backupName);
    var rec = { id""")
rep("""    return { ok: true, importId: rec.id, counts: rec.counts, created: rec.created.length, linked: rec.linked.length };""",
    """    return { ok: true, importId: rec.id, counts: rec.counts, created: rec.created.length, linked: rec.linked.length, backup: backupName };""")
p.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("ok")
