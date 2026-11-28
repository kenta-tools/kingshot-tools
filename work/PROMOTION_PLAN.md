# test → 本番 まとめて昇格の計画（2026-11-13）
## 道具
- `python work/promote_test_to_prod.py`（ドライラン）／`--apply`（コピー）／`--verify`（本番側にtest用の設定が無いか）
- `node work/test_gas_sim.mjs [GASコード] [pubGetのJSON]`（本番データの形でGASを模擬実行。本番へは読み取りのみ）
- `node work/smoke_pages.mjs`（昇格後の本番ファイルが開けて、JSエラーなし・本番GASだけを向く・読み取り以外を呼ばない）
## 順序（推奨）
1. GAS（候補 gas_clasp\work_prod_candidate_all\コード.js ＝ work/gas_members_proxy.gs と同一）を push→deploy -i。前: 現コード.js を backup_members_proxy\ へ。後: pubGet の件数（users/events/entries/kvkRosters/flameRosters/matchupPairs）が同じこと。※画面は旧のままでも動く（旧画面が送る項目は無視されるだけ）。ただし旧カウントダウン表の共有名簿は新形式になるため、2の直後に画面を昇格する。
2. 画面の昇格：`--apply` → `--verify` → `node work/smoke_pages.mjs` → コミット（?v=は付けない）→ push。
3. 確認（Pages反映まで1〜2分・最大10分）：登録ページ・遺跡ページが開く／管理画面にログインして新規イベント作成にアンケート欄が出る／カウントダウン表（共有用）が「設定＋名簿1」で開く／チーム分け（管理）が開く。
4. そのあとにユーザーが全リセット（data-reset.yml）→ 100人取り込み。昇格が先なら、新しいイベントにアンケートが付く。
## ロールバック
- GAS：backup_members_proxy\ の直前ファイルを gas_clasp\members_proxy\コード.js に戻して push→deploy -i（固定ID）。データ形式は旧コードで読める（kvkRosters の新形式は旧コードでは tabs を無視して rows＝最初のタブ（設定）の行を旧形式の名簿として読むので、共有名簿だけ表示が崩れる→ロールバックするなら共有名簿は消して作り直す）。
- 画面：昇格コミットを `git revert`（config.js のホイール追記も戻る）。
