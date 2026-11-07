// 環境依存の設定だけをまとめたファイル（テスト用）。
// 本番の config.js との違いは GAS_URL と、下のテスト環境用の設定（保存キーの分離・背景の目印）だけ。
// ロジック本体（test/配下の各ページ）は本番と同じファイル。
// テスト用の中継役（GAS）・データは本番と完全に別物なので、ここで保存しても本番データには影響しない。
const GAS_URL = "https://script.google.com/macros/s/AKfycbztnub9vRBiRHdL5Xea7hoThHWRzDSF9Www0eImUs8YlZQglMKNnMR90v6hD87hMlPk/exec";

// 本番と test/ は同じドメイン（kenta-tools.github.io）なので、ブラウザの保存領域（localStorage・sessionStorage）を共有してしまう。
// そのままだと本番でログインしたパスワードや管理画面の下書きが test/ に流れ込み、「保存用のパスワードが合いません」等になるため、
// テスト環境では保存キーの頭に "test_" を付けて本番と分ける（各ページのコードは本番と同じまま）。
// ※このファイルより前に読み込まれる処理（サイドバーの開閉状態など）は本番と共有のまま
(function() {
  var PREFIX = "test_";
  ["getItem", "setItem", "removeItem"].forEach(function(name) {
    var orig = Storage.prototype[name];
    Storage.prototype[name] = function(key) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = PREFIX + key;
      return orig.apply(this, args);
    };
  });
})();

// 本番の中継役のURL（テスト用TOPの「本番データで上書き」で、本番データの取得にだけ使う。本番の config.js には無い）
const PROD_GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec";

// テスト環境の目印（本番の config.js には無い）。TOPの「本番へ戻る」リンクなどの判定に使う
const IS_TEST_ENV = true;

// 本番と見分けやすいよう、テスト環境だけ背景にオレンジの斜線を重ねる（各ページの背景色はそのまま、その上に重ねる）
(function() {
  var st = document.createElement("style");
  st.textContent = "html body { background-image: repeating-linear-gradient(-45deg, rgba(255,140,0,0.16) 0 16px, transparent 16px 32px) !important; background-attachment: fixed !important; }";
  (document.head || document.documentElement).appendChild(st);
})();
