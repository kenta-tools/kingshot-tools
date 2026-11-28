// 速度ペット「恐怖の咆哮（グリズリー）」のLv別ボーナス(%)を、画面から編集できるようにする共通部品。
// 「KvK同着スタート カウントダウン表」「炎龍 集結タイムライン計算」の両方で読み込み、
// 同じlocalStorageキー（このブラウザだけ）に保存する。保存が無ければ初期値を使う。
//
// 使い方：
//   let MARCH_PET_BONUS = KsPetBonus.load();
//   KsPetBonus.mount(document.getElementById("petBonusEditor"), arr => { MARCH_PET_BONUS = arr; 再描画(); });
(function(){
  var KEY = "ksMarchPetBonus";
  // [0]=ペットなし、[1]〜[8]=Lv1〜Lv8。Lv1=15%、Lv7まで2%ずつアップ、Lv8のみ+3%
  var DEFAULT = [0, 15, 17, 19, 21, 23, 25, 27, 30];

  function isValid(a){
    return Array.isArray(a) && a.length === DEFAULT.length &&
      a.every(function(n){ return typeof n === "number" && isFinite(n) && n >= 0; });
  }
  function load(){
    try {
      var a = JSON.parse(localStorage.getItem(KEY));
      if (isValid(a)) { a[0] = 0; return a; }
    } catch (e) {}
    return DEFAULT.slice();
  }
  function save(a){
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }
  function reset(){
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function isDefault(a){
    return a.every(function(n, i){ return n === DEFAULT[i]; });
  }

  var STYLE = [
    ".pb-edit { margin-top:12px; font-size:0.85rem; }",
    ".pb-edit summary { cursor:pointer; color:#2f6fed; }",
    ".pb-edit .pb-body { margin-top:8px; padding:10px; border:1px solid #ddd; border-radius:6px; background:#fafbfc; }",
    ".pb-edit .pb-grid { display:flex; flex-wrap:wrap; gap:8px 14px; margin:6px 0 10px; }",
    ".pb-edit .pb-grid label { display:flex; align-items:center; gap:4px; white-space:nowrap; }",
    ".pb-edit .pb-grid input { width:64px !important; }",
    ".pb-edit .pb-note { font-size:0.78rem; color:#666; margin:0; }",
    ".pb-edit .pb-changed { color:#c0392b; font-weight:bold; }",
  ].join("\n");

  function mount(container, onChange){
    if (!container) return;
    if (!document.getElementById("pbEditStyle")) {
      var st = document.createElement("style");
      st.id = "pbEditStyle";
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    var cur = load();
    var html = '<details class="pb-edit"><summary>速度ペットのボーナス%を編集する（このブラウザだけ） <span class="pb-changed"></span></summary>' +
      '<div class="pb-body">' +
      '<p class="pb-note">ペットあり秒数 ＝ ペットなし秒数 ÷ (1 + ボーナス% ÷ 100)。ここで変えた値は「KvK同着スタート カウントダウン表」と「炎龍 集結タイムライン計算」の両方に反映されます。</p>' +
      '<div class="pb-grid">';
    for (var lv = 1; lv < DEFAULT.length; lv++) {
      html += '<label>Lv' + lv + ' <input type="number" class="ve-exempt" min="0" max="500" step="0.1" data-lv="' + lv + '" value="' + cur[lv] + '">%</label>';
    }
    html += '</div><button type="button" class="btn secondary small ve-exempt pb-reset">初期値に戻す</button></div></details>';
    container.innerHTML = html;

    var badge = container.querySelector(".pb-changed");
    var inputs = container.querySelectorAll("input[data-lv]");
    function refreshBadge(a){ badge.textContent = isDefault(a) ? "" : "※初期値から変更中"; }
    refreshBadge(cur);

    function readInputs(){
      var a = cur.slice();
      Array.prototype.forEach.call(inputs, function(inp){
        var v = parseFloat(inp.value);
        if (isFinite(v) && v >= 0) a[Number(inp.dataset.lv)] = v;
      });
      return a;
    }
    Array.prototype.forEach.call(inputs, function(inp){
      inp.addEventListener("change", function(){
        cur = readInputs();
        save(cur);
        refreshBadge(cur);
        onChange(cur.slice());
      });
    });
    container.querySelector(".pb-reset").addEventListener("click", function(){
      reset();
      cur = DEFAULT.slice();
      Array.prototype.forEach.call(inputs, function(inp){ inp.value = cur[Number(inp.dataset.lv)]; });
      refreshBadge(cur);
      onChange(cur.slice());
    });
  }

  window.KsPetBonus = { load: load, mount: mount, DEFAULT: DEFAULT.slice() };
})();
