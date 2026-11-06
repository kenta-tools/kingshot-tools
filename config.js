// 環境依存の設定だけをまとめたファイル（本番用）。
// ロジック本体（各ページ・admin-common.js・kvk-auth-gate.js・view-edit-gate.js等）は
// 本番・テスト（test/配下）で完全に同じファイルを使う。違うのはこのファイルの中身だけ。
// test/config.js はテスト用の中継役（GAS）のURLを指すように、この内容を書き換えて使う。
const GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec";
