/* 外觀切換：淺色（白底）／深色（深海藍底）。選擇存在 localStorage，預設深色。
   放在 <head> 內同步載入，先設好 data-theme，避免畫面閃一下。 */
(function () {
  var KEY = 'journal-theme', root = document.documentElement;
  function load() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'dark'; } catch (e) { return 'dark'; } }
  function apply(t) {
    root.setAttribute('data-theme', t);
    var btns = document.querySelectorAll('.theme-switch [data-theme-set]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-theme-set') === t ? 'true' : 'false');
  }
  apply(load());
  document.addEventListener('DOMContentLoaded', function () {
    apply(load());
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-theme-set]');
      if (!b) return;
      var t = b.getAttribute('data-theme-set');
      try { localStorage.setItem(KEY, t); } catch (err) {}
      apply(t);
    });
  });
})();
