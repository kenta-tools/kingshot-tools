// 環境依存の設定だけをまとめたファイル（テスト用）。
// 本番の config.js とこのファイルの違いはGAS_URLだけ。ロジック本体（test/配下の各ページ）は本番と同じファイル。
// テスト用の中継役（GAS）・データは本番と完全に別物なので、ここで保存しても本番データには影響しない。
const GAS_URL = "https://script.google.com/macros/s/AKfycbztnub9vRBiRHdL5Xea7hoThHWRzDSF9Www0eImUs8YlZQglMKNnMR90v6hD87hMlPk/exec";
