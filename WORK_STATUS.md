# キングショットHTML - 作業状況

## 概要
Kingshot関連の単体HTMLツールのうち、ゲームプレイの実務でよく使う5つだけを集約したフォルダ（2026-09-01、ユーザー指示でスコープを絞り込み）。`index.html` がメニュー（トップページ）で、各ツールを一覧・リンクできる。各HTMLの左側に共通サイドバーメニューを表示し、どのページからでも他のツールへ移動できる。

## ファイル構成（このフォルダにあるのはこの5つのみ）
- `index.html` — メニュー（トップページ）
- `炎龍の覇者_攻城タイムライン計算.html` — 「炎龍 集結タイムライン計算」（[[project_kingshot_ojo_siege]]のメイン合わせ集結）
- `王城到着同期カウントアップ.html` — 「KvK同着スタート カウントアップ表」
- `KvK占領判定.html` — 「KvK占領戦 勝利判定ツール」
- `周期ウェーブタイマー.html` — 「周期ウェーブタイマー」
- `音声アナウンス付きストップウォッチ.html` — **工事中**（2026-09-01、ユーザー指示で中身を工事中プレースホルダーに差し替え。メニューにも「工事中」バッジ表示）
- `work/inject_sidebar.py` — 全HTMLに共通サイドバーを注入するスクリプト。新しいツールを追加/削除したら、このスクリプトの`TOOLS`リストを更新してから再実行する

**ページタイトルとメニュー表記は完全一致させること**（2026-09-01ユーザー指示：「メニューとタイトル合わせて」）。`<title>`・`<h1>`・`index.html`のカード名・サイドバーのラベルの4箇所が同じ文言になっているか、変更のたびに確認する。

## このフォルダに置かないもの（2026-09-01、スコープ外として移動済み）
- 炎龍ランキング系HTML（`炎龍の覇者_ランキング_778-849鯖_20260829.html`等）→ `キングショット手動ツール\` へ戻した
- `パック価値換算.html` / `宝探しツール.html` → `kingshot_value\` へ戻した
- 上記4ファイルからは、もう存在しないファイルへのリンクが残らないようサイドバーを除去済み

## サイドバー注入の仕組み（2026-09-01 レスポンシブ対応版）
各HTMLの`<body>`直後に `<!-- ks-sidebar:start -->` 〜 `<!-- ks-sidebar:end -->` のマーカーで囲んだサイドバーHTML＋共通スタイルを挿入している。ページ本体のCSS構造は一切変更していない（`!important`でmargin-leftのみ上書き）ので、既存ツールの内部デザインへの影響は最小限。マーカーがあるファイルは再実行時に安全に置き換えられる（二重挿入されない）。

- PC幅（760px超）：左固定サイドバー（220px）
- モバイル幅（760px以下）：サイドバーが上部の横スクロールバーに変形（`display:flex`＋`overflow-x:auto`）。bodyは`padding-top`で回避
- `<meta name="viewport">`が無いページには自動で追加（`王城到着同期カウントアップ.html`は元々なかったため今回追加された）
- モバイル幅では`table`・`.card`・`.panel`・`.result-wrap`を横スクロール可能にする安全策も追加（ユーザー指示「全部レスポンシブにしてほしい」2026-09-01対応）

## 経緯
2026-08-31〜09-01の作業で、Kingshot関連ツールを以下のフォルダに分けて整理：
- `kingshot_tools`（自動系：Bot・CLI・定期実行スクリプト）
- `キングショット手動ツール`（Excel手動編集：KvK用ツール.xlsx、ランキングHTML等）
- `キングショットHTML`（★このフォルダ。ゲームプレイでよく使う5ツールのみ）
- `kingshot_value`（パック価値・宝探し関連HTML）

詳細な経緯・ルールは[[feedback_kingshot_tools_folder]]・[[reference_kingshot_tools_inventory]]参照。

## 2026-09-01 追加：サイドバー開閉機能
全ページ共通サイドバーに開閉トグルを追加。開いている時は220px幅（アイコン＋ラベル）、閉じると56px幅のアイコンのみレール表示に縮小（ラベルはホバー時に`title`属性でツールチップ表示）。状態は`localStorage`（`ksSidebarCollapsed`）に保存され、ページ遷移後も維持される。トグルボタンは矢印（←閉じる／→開く）。モバイル幅では別動作（サイドバーごと上に隠れ、左上に☰ボタンで再表示）。`work/inject_sidebar.py`で一括管理。

## 2026-09-01 周期ウェーブタイマーの機能追加
- 周期・MAXの入力を「分」「秒」の2フィールドに分割
- 「MAX＋◯秒まで表示」「次の周期を－◯秒から出す」を設定可能に（旧来はコード内固定値だった）
- ストップ押下で経過時間・カウンターを完全に凍結する`pausedAt`/`getRefNow()`の仕組みを追加（旧実装はストップしても数字が動き続ける不具合があった）
- 右側（またはカウンターカード内）に「炎龍 集結タイムライン計算」の出力を貼り付けて自動保存（localStorage）できる欄を追加。貼り付けたテキストをパースし、**1週分のタイムラインを無限ループする前提で**、経過時間に応じて「まだ終わっていないパターン（①②③…）」を1個目のカウンターカードの右側に表示する
- **重要：周期（1周の長さ）はテキスト中の「周期：◯分◯◯秒」の行を最優先で読み取って使う**（[[project_kingshot_ojo_siege]]のツールがこの行を出力する前提）。この行が無い場合のみ、パターンの発起時刻の範囲から簡易計算するフォールバックを使うが、これは行軍・帰還・クールダウン分を含まないため実際の周期より短く出る欠陥がある（2026-09-01に実データで発見・修正）
- パターン一覧の表示ロジック：現在の周（ループ）が進行中なら未終了のパターンだけを個別に表示。全部終了したら（クールダウン中など次の周が始まるまでの間）、その周の全パターンを履歴として表示し続ける

## 2026-09-01 炎龍の覇者_攻城タイムライン計算.html の出力仕様変更
- 「周回数」の入力欄を削除し、内部的に常に2周分計算する（周期を求めるためだけに必要）
- メイン出力（コピー用）は**1周目のみ**＋末尾に「周期：◯分◯◯秒」の行を追加（周期ウェーブタイマーがこの行を読み取ってループ長を決めるため必須）
- 「参考：2周分の計算結果」という別カードを追加し、1周目・2周目の両方をまとめて確認用に表示（コピー対象ではない）
- 出力フォーマット自体（`◯分◯◯秒`表記、`→メイン→増援`、`※行軍◯◯秒（◯◯着、◯◯帰還）`）は変更していない（一度mm:ss形式に変えたが「元に戻して」と指示があり撤回済み、[[project_kingshot_ojo_siege]]参照）

## 2026-09-01 周期ウェーブタイマーのパターン一覧：周ごとの独立カウントダウンに変更
- ①②③...を個別に判定：今の周でまだ終わっていなければそのまま表示、終わっていれば次の周でまた始まるまでのマイナスカウントダウンを表示
- 「次の周期を－◯秒から出す」設定（ウェーブカウンター自体の先出し表示）は廃止・削除
- 次の周を待っているパターンは、1個目のカード内の小さいリストではなく、「2周目」ラベル付きの独立した大きな時計表示カードにまとめて表示（複数パターンが同時に待機中でも1枚にまとまる、代表値は一番早く再開するものの残り時間）
- **周期の値はテキスト中の「周期：」の行を最優先で使う**（発起時刻の範囲だけから計算すると行軍・帰還・クールダウン分が抜けて短く出るバグがあったため、2026-09-01に実データで発見・修正。[[project_kingshot_ojo_siege]]参照）

## 2026-09-01 4ツールに入力値の自動保存を追加
以下4ツールで、入力した値がこのブラウザの`localStorage`に自動保存され、次回開いたときも復元されるようにした（`音声アナウンス付きストップウォッチ.html`は工事中のため対象外）：
- `炎龍の覇者_攻城タイムライン計算.html` — メンバー表・パターン設定・共通設定（保存キー`siegeCalcState`）
- `王城到着同期カウントアップ.html` — 名簿・最大カウント秒（保存キー`kvkCountupRosterState`）
- `KvK占領判定.html` — 同盟名・占領時間・試合時間（保存キー`kvkOccupationState`）
- `周期ウェーブタイマー.html` — 周期・MAX・MAX＋◯秒設定（保存キー`waveTimerSettings`。貼り付けタイムラインは既存の`waveTimerPastedTimeline`キーで別途保存済み）

## 2026-11-01 追加：メンバー管理（管理者ページ）
イベントのチーム分け用にメンバー登録機能を追加（今後この登録データを元にチーム分け機能を作る予定）。
- `admin/members-admin.html` — 管理者専用ページ。どのページ・サイドバーからもリンクしない（URL直打ちで開く）。`noindex`指定
  - 認証：SHA-256ハッシュ照合の簡易パスワード（静的サイトのため「目隠し」レベル。ソースやdata/members.jsonは誰でも見られる）。ログイン状態はsessionStorage
  - 登録方法：①Discordの募集フォーマット貼り付け（複数同盟・最初から/途中参加の見出し混在OK）②ファイル（.txt/.csv/.json）③1人ずつ登録・変更・キャンセル・削除
  - 編集中はブラウザのlocalStorageに下書き保存 → 「members.json を書き出し」→ `data/members.json` を置き換えて commit・push で公開
  - 登録内容を募集フォーマットのテキストに書き戻す機能あり
- `data/members.json` — 登録データ（チーム分けツールが読み込む想定）
- ログインパスワード：2026-11-01にページ内のハッシュを廃止。中継役GASのスクリプトプロパティ EDIT_PASSWORD だけで管理し、ログインも保存も中継役が確認（変更はGAS側のプロパティを書き換えるだけ、再デプロイ不要）。旧 work/set_admin_password.py は削除
- 募集フォーマットの読み取りルール：見出し「同盟名(最初から参加できる)」「同盟名(途中参加)」、`G8/G7/G6/G5/その他:`行に「、」区切りでメンバー。名前の後ろの◯マンスリー/△途中抜け/◇VC/◆ビビアン星4以上。括弧は (〜22時)=抜ける時刻（△も自動ON）、(23時〜)=参加開始、(T11)=3兵種T11、(歩弓T11)/(歩弓)=兵種指定、それ以外は備考
- 2026-11-01改修：データを「ユーザー（蓄積）」「イベント」「イベントごとの参加情報」の3層に分割
  - ユーザーは**名前だけ**で同一人物判定（同盟は最新値に更新）。改名で別人登録された場合はユーザー一覧の「統合」でまとめる
  - イベントは種類プルダウン（KVK／聖剣／聖剣リーグ／三盟／炎龍）＋開催日で作成。取り込み・フォーム・一覧・CSV・フォーマット書き出しは選択中イベントが対象
  - members.json形式: `{updated, users:[{id,name,alliance}], events:[{id,type,date}], entries:[{id,eventId,userId,alliance,entry,grade,monthly,leaveEarly,vc,vivian4,troops,tier,joinAt,leaveAt,note}]}`
  - 似た名前の判定（2026-11-01追加）：取り込み確認表の「ユーザー判定」で、似た名前の行は「新規／〇〇と同一人物（名前を更新／そのまま）」を管理者が選ぶ。同一にした名前はaliases（旧名・別表記）に記録して次回から自動一致。既存ユーザー同士は「似た名前の候補」で統合（どちらを残すか）か「別人」（notSameに記録）を選ぶ。類似判定は全角半角・大小文字・カナひら・記号を無視＋編集距離（4文字以下は1、それ以上は2）＋包含
  - 保存（2026-11-01改修）：「GitHubに公開」ボタンで GitHub Contents API から data/members.json を直接コミット。公開時に最新を取得し、下書きの base（読込時点の公開版）との差分（自分の追加・変更・削除）だけを最新に重ねる3-wayマージ。同じ種類+開催日のイベント・同じ名前のユーザーは統合。409時は1回リトライ
  - 2026-11-01追加：GitHubにログインできるのは本人(kenta-tools)だけ、サイトからの登録は他の人もできる方針 → 中継役 Google Apps Script（work/gas_members_proxy.gs）経由で保存。GASのスクリプトプロパティに GITHUB_TOKEN と EDIT_PASSWORD（=ログインパスワード）。管理画面はログイン時のパスワードをsessionStorageに持ち、GASへtext/plainでPOST。members-admin.html の GAS_URL に ウェブアプリURLを設定する（2026-11-01デプロイ・設定済み、kenta.mail.777@gmail.com のGAS）
  - トークン：kenta-tools の Fine-grained PAT（kingshot-tools のみ、Contents: Read and write）を管理者ごとにブラウザへ保存（localStorage ksGhToken）。サイトには載せない
  - AIプロンプトはイベント名と登録済みユーザー一覧を埋め込み、「まとめて出力」時にAIが似た名前を登録者に確認 → sameAs で返す
  - AI変換プロンプト（募集フォーマット→JSON）をコピーしてAIで変換→貼り付けて取り込む運用がおすすめ

## 2026-11-01 個人登録ページ（entry/index.html）追加
- URL: https://kenta-tools.github.io/kingshot-tools/entry/ （TOPにカード「📝 イベント参加登録」）。認証なし
- 管理画面のイベント欄で「受付を始める／締め切る」→「💾 保存する」で反映（events[].open）。受付中のイベントだけ個人登録できる
- 流れ: イベント選択→名前入力→（似た名前があれば「この中にあなたはいますか？」）→参加情報→登録。名前を選べば変更・取消可
- 候補から既存ユーザーを選んで名前が違う場合は、本人の申告として名前を更新し前の名前は旧名に残す
- 保存は中継役GASの新アクション pubGet / selfSave（パスワード不要、受付中イベントの1人分だけ変更、LockService＋409再試行、全体で1分60件まで）
- **GASを新バージョンで再デプロイしないと個人登録ページは動かない**（work/gas_members_proxy.gs を貼り替え→デプロイを管理→新バージョン）
- テスト: GASロジック13項目・個人登録画面14項目・管理画面の受付切替＋同時個人登録のマージ10項目、いずれもheadless Chromeで合格
- 2026-11-01 追記: 項目追加（entries に marchCount/marchPet＝全員必須、rallyCount/rallyPet＝集結の指示があった人のみ）。個人登録ページをITに疎い人向けに簡素化（①②③の3行手順、押して選ぶボタン、途中参加/途中抜け/集結は押したときだけ欄が出る）。管理画面の一覧・フォーム・CSV・AI用データにも反映。GASも更新したので再デプロイ必要
- 2026-11-01 追記2: 参加に「不参加」（entry=absent、管理画面では同盟内の最後・AI用/募集フォーマット/人数から除外）。兵種は「T11の兵種を選ぶ」に変更しT入力欄を廃止（選択時tier=11）。同盟は英字3文字チェック。GAS再デプロイ必要
- 2026-11-01 追記3: 集結の指示があった人に行軍速度ペット（rallySpeedPet、グリズリー）を追加。ペットLvは効果付きの選択式（0＝持っていない）。出征容量 Lv×1500(最大10)、集結容量 50000+Lv×10000(最大10)、行軍速度 Lv1=15%〜Lv7=27%(+2%ずつ)、Lv8=30%。GAS再デプロイ必要
- 2026-11-01 追記4: ペットLvの最大値（出征・集結容量Lv10、行軍速度Lv8）を管理画面（選択式）・取り込み・GASでも制限。GAS再デプロイ必要
- 2026-11-01 追記5: 次のイベントで前回（不参加以外の最新イベント）の入力を初期値に（data/members.json を読む、GAS変更なし）。時刻・途中抜け・ひとことは引き継がない。集結欄をオレンジ枠＋見出しで強調
- 2026-11-01 追記6: 登録済み一覧に同盟フィルタ・全項目・「直す」。イベント状態を 受付中/イベント進行中/完了（events[].done）にし、完了は別ブロック。参加情報に updatedAt（GAS・管理画面で記録、両一覧に表示）。参加時間の連絡の注意を赤字で。GAS再デプロイ必要
- 2026-11-01 追記7: GASはclaspでClaudeが再デプロイ可能に（C:\Users\itvalue\claude\キングショット\gas_clasp\members_proxy、deploy -i で同じURL、現在@5）。updatedAt入りを本番デプロイ・実機確認済み
- 2026-11-01 追記8: 保存先をGitHubのdata/members.json→Googleドライブ非公開ファイルに移行（GAS DATA_FILE_ID/DATA_VERSION、setupStorage実行済み、@8〜）。data/members.json削除済み（サイトで404）。個人登録の記録(IP)をGASスクリプトプロパティに保存・管理画面で表示。参加を全部/一部/不参加に、名前変更、確認方法ボタン、ペットにスキル名。現在GAS @9
- 2026-11-02: 登録ページにDiscord参加の案内（招待リンク https://discord.gg/NZj5xSpbY は30日で期限切れ＝12/1頃。無期限リンクができたら entry/index.html の href を差し替え）。何時から/まではtime入力（保存は21時/21時30分）
- 2026-11-02: Discord招待リンクのbot自動更新（GAS refreshDiscordInvite/setupDiscordInvite、@14）は作成済み。ユーザーがサーバー管理者でないためbot追加・プロパティ設定は保留。予備リンク https://discord.gg/NZj5xSpbY は12/1頃期限切れ
- 2026-11-02: 容量（計算後）を entries の marchCap / rallyCap に保存（GAS cleanEntry_→calcCap_、管理画面 normalizeRow/toEntry→withCap）。条件は固定：両ペットスキルあり・バフ20%をスキルなしの出征容量にかけ、出征で増えた分（スキル＋バフ）を集結容量にも足す。管理画面の容量設定欄は削除、「1人ずつ登録」欄は一覧の「変更」時だけ表示。GASの部隊数上限 99,999→99,999,999 に修正。GAS @15
- 2026-11-02: TOPに「📘 仕様まとめ」（spec/index.html が spec/spec.md を読み込んで表示、AIに渡す用コピー・URLコピー）。**サイトを更新したら必ず spec/spec.md も同じコミットで更新する**（ユーザー指示）。登録ページの一覧を「登録状況を見る」にし、今回未登録の人を前回イベントの内容で灰色表示（参加・時間・ひとこと・更新日時は空欄、ボタンは「登録する」）。管理画面の受付ボタンを「受付を始める」に
- 2026-11-02: Discord招待リンクの自動更新は、DiscordがGASからの通信を403(40333)で断るため GitHub Actions（.github/workflows/discord-invite.yml＋.github/scripts/discord_invite.py、毎日20:00UTC＝5:00JST、手動実行可）に移行。7日有効のリンクを作り、botの古いリンクを削除、中継役 action=setDiscordInvite（パスワード必須）で保存→pubGet discordInvite。Secrets: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID / RELAY_PASSWORD（ユーザーがGitHubの画面で登録）。GASの refreshDiscordInvite はトリガーの後始末だけ

## 2026-11-03 チーム分け機能（担当: claude-76 セッション）
- ヒアリングで決めた方針：KVK＝集結リーダー＋乗り手（集結容量に収まるように詰める、人数8〜10は警告のみ、参考ルール kakeoProduct/KvK-Team-Builder を簡略化して取り入れ）／聖剣・聖剣リーグ＝「集結主」チーム＋乗り手チーム（出征容量の合計をそろえる）／三盟＝上・中・下を手動。分け方（ボード／自動→ボード／表）は全部作って使いながら決める。参加時間の使い方は未定（時間帯タブで表示だけ）
- 追加ファイル：`admin/teams.html`（管理、軽量方式＝認証＋サイドバー自前、admin-common.js非依存）、`teams/index.html`（公開閲覧、パスワードなし）
- GAS：`teamSave`（パスワード必須。d.teams にイベントごと {draft, updatedAt, published, publishedAt}。baseUpdatedAt が違えば conflict を返し force で上書き）、`teamsGet`（パスワード不要、公開分のみ・draftなし）。既存の pubGet・put は変更なし（管理画面の保存は d.teams を残す作り）
- 既存ファイルへの最小変更：ADMIN_NAV に teams.html（admin-common.js・inquiries.html・kvk-matchup/kvk-auth-gate.js）、TOPにカード、entry/index.html に独立した表示欄 #teamsBanner＋末尾の別script（teamsGetだけ使う。既存処理は不変）
- テスト：GAS関数14項目（Node）、画面60項目（headless Chrome＋偽GAS）すべて合格
- 今後の検討：参加時間の使い方（時間帯ごとの割り当て等）、応援・遅れて出撃、セット（同じ隊にする組）、カウントダウン表のグループ列への連携

## 2026-11-03 「Kingshotツール作成」から引継ぎ（担当: tools/・admin/(teams除く)・kvk-matchup/・ランキング・TOP・spec・自動更新系）
- ②速度ペットのボーナス%を画面から編集：共通部品 `tools/pet-bonus.js`（localStorage `ksMarchPetBonus`、無ければ初期値 [0,15,17,19,21,23,25,27,30]）。KvK同着スタート カウントダウン表・炎龍 集結タイムライン計算の名簿/メンバー表の下に `<details>` の編集欄。変更時は表を再描画し、結果表示中なら再計算。閲覧モードでも使える（ve-exempt）。headless Chromeで両ページ確認済み
- ⑦KvK相手突合せの秘境の試練をK/M省略なしに：`abbreviate(n, board)`（kingshot_tools/kvk_matchup.py・.github/scripts/kvk_matchup_refresh.py・両方のSCRIPT_TEMPLATE内JS）でboard=="trial"ならカンマ区切りそのまま（試練は数千なのでMも使わない）。1065鯖レポートはrefreshスクリプトをローカル実行して再生成済み
- ⑥KvK相手突合せに参加可否：うちの名前の横にバッジ（最初から/途中参加/不参加/未登録）。上部のイベント選択に連動、pubGetのusers＋history.entriesを使用（GAS変更なし）。名前一致はカウントダウン表の nameKey()/findRegUser() と同じ。両スクリプトのテンプレート（BODYの行・HEADのCSS・SCRIPT_TEMPLATE）に追加し、1065鯖レポート再生成済み
- ⑤管理者ログインに「パスワードを保存する」：チェック時のみ localStorage `ksAdminPwSaved` にも保存。各ゲートの先頭で「sessionStorageが空でksAdminPwSavedがあれば sessionStorage.ksAdminPw に戻す」ので、既存の sessionStorage 参照コードはそのまま動く。ログアウトで両方消す。対象：index.html・tools/view-edit-gate.js・kvk-matchup/kvk-auth-gate.js（＋headの非表示チェックをlocalStorageも見るよう、両スクリプトのHEADテンプレート・既存レポート・kvk-matchup-index.html）・admin/admin-common.js（チェックボックスはJSで#loginBtnの前に差し込み）・admin/inquiries.html。admin/teams.html（claude-76担当）は未対応→リーダー経由で依頼
- ③KvK同着スタート カウントダウン表に自分用タブ：周期ウェーブタイマーと同じ方式（`kvkCountdownTabs`/`kvkCountdownCurrentTab`、最初のタブは既存キー `kvkCountdownRosterStateV2` を引継ぎ、他は `_<id>` 接尾辞）。「＋」=空の名簿、「このタブを複製」=今の名簿のコピー。共有用モードではタブバー非表示。maxSec・ペット%は全タブ共通
- ④スマホのメニューをハンバーガー式に統一：760px以下で上部固定バー（タイトル＋右上 .ks-menu-btn ☰/✕）、押すと nav が下にドロップダウン（body.ks-menu-open）。外タップで閉じ、そのタップは capture で止めて下に通さない（mousedownもpreventDefault）。PCの折りたたみ（ks-collapsed）はスマホでは無視。対象：work/inject_sidebar.py（テンプレート、tools/の生成5ページ）＋非表示2ページ（王城到着同期・ストップウォッチ、旧版サイドバーに同じ差し替え）・admin/admin-common.js・admin/inquiries.html・kvk-matchup/kvk-auth-gate.js。admin/teams.html はリーダー経由で同じ差分を依頼
- タブの並べ替え（ユーザー依頼）：KvK同着スタート カウントダウン表・周期ウェーブタイマーの両方に `moveTab()`/`attachTabReorder()`。PCはタブをドラッグ＆ドロップ、スマホ（両方）は選択中タブの ◀ ▶。並びは各TABS_KEYの配列順で保存
- 2026-11-03 追記：ユーザー指示「チーム分けは確定するまで工事中」。公開側だけ工事中（teams/index.html は `UNDER_CONSTRUCTION = true` で🚧表示、TOPカードに工事中バッジ、entry/index.html の #teamsBanner の script 先頭で `if (true) return;`）。管理画面 admin/teams.html は今まで通り使える。**確定したら3か所を戻す**（UNDER_CONSTRUCTION=false、entryの `if (true) return;` を削除、TOPのバッジと説明文）。spec.md の「工事中」の記述も消す

## 2026-11-07（リーダー経由のバグ報告対応）
- 聖剣リーグS2を手動で最新化（holy_sword_s2_refresh.py をローカル実行、PYTHONIOENCODING=utf-8 が必要）f7cf01b
- admin/participants.html でイベント切替が効かない：eventSelect の change 処理が参加者一覧ページに無い #bulkMsg/#previewWrap に書いて例外→render されなかった。ある欄だけ消すよう修正
- JSON等の取り込みで出征数などが消える：upsertEntry が参加情報を丸ごと置換していた。取り込み行に `_given`（元データで値が入っていた項目）を付け、`mergeImported()` で入っていない項目は既存値を残す（置き換えモードでも残る人の値を引継ぎ）。フォーム保存は従来通り全項目
  - 実データ確認：11/7 KVKの34人は 11/03 12:55 の一括取り込みで全員 updatedAt が同一、部隊数・ペットは全イベントで0件。それ以前の個人登録の値が消えた可能性 → 復旧はドライブのデータファイルの版の履歴から（未実施、ユーザー判断待ち）
- KvK相手突合せを試練基準に：`sort_by_trial()`（kvk_matchup.py・refreshの両方。mystic_ranking.py の merge_and_rank は炎龍と共通なので触らない）。refresh は名簿固定のままその日の試練順に並べる。kvk_matchup.py に `--file-date YYYYMMDD`（既存レポートを同じURLで作り直す）を追加。1065鯖は試練上位12人で作り直し済み（--file-date 20261103）
- 突合せの参加可否が出ない件：原因はJSON取り込みではなく名前の違い（城焼担当↔城焼、Jaguar↔ジャガー等）。looseKey（NFKC・小文字・カナ→ひら・記号除去）で完全一致→確定、イベント登録者で部分一致1人→「≈」推定。推定・未登録には登録者プルダウン＋「紐づけ」→ GAS 新アクション `addAlias`（パスワード必須、別ユーザーと衝突する名前は409）で旧名に追加
- 検索エンジン対策（外部協力者の指摘→リーダー経由）：robots.txt はプロジェクトサイトでは効かないため、全HTMLに `<meta name="robots" content="noindex, nofollow">`。work/stamp_version.py が無いページに自動挿入（毎回のコミット前実行で新規ページもカバー）。Actionsで丸ごと再生成されるページ用に、mystic_ranking.py・kvk_matchup.py・kvk_matchup_refresh.py・holy_sword_s2_refresh.py のHEADテンプレートにも追加
- GAS @27（addAlias 追加）デプロイ済み
- 遺跡争奪の管理画面対応（ユーザ登録担当の d66b284 を受けて）：EVENT_TYPES に追加、normalizeRow で `slots` を保持（normSlots＝中継役 cleanEntry_ と同じく RUIN_SLOTS のキーで yes/maybe/no だけ残す）、フォーム変更・取り込み更新でも既存 slots を保持。参加者一覧は遺跡争奪のとき見出しを時間列に差し替え（setEntryHead、並べ替えクリックはイベント委譲に変更）、Discord用集計 #ruinSumBox（JSで差し込み）、AI用データは buildRuinAiText
