(function () {
  'use strict';

  var uptime = document.getElementById('uptime');
  if (uptime) {
    var start = Date.now();
    var pad = function (value) { return String(value).padStart(2, '0'); };
    window.setInterval(function () {
      var elapsed = Math.floor((Date.now() - start) / 1000);
      uptime.textContent = 'session uptime · ' + pad(Math.floor(elapsed / 3600)) + ':' + pad(Math.floor((elapsed % 3600) / 60)) + ':' + pad(elapsed % 60);
    }, 1000);
  }

  var year = document.getElementById('footer-year');
  if (year) year.textContent = '© ' + new Date().getFullYear() + ' · pokedb.site';

  var cards = document.querySelectorAll('.project-card');
  if (cards.length) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      cards.forEach(function (card) { card.classList.add('is-visible'); });
    } else {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      cards.forEach(function (card) { observer.observe(card); });
    }
  }

  window.showToast = function (message, duration) {
    duration = duration || 2500;
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.className = 'mono';
    toast.style.cssText = 'padding:0.6rem 1rem;background:var(--surface);color:var(--text);border:1px solid var(--accent);border-radius:6px;box-shadow:var(--shadow);font-size:0.8rem;opacity:0;transform:translateY(8px);transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1);pointer-events:auto;';
    toast.textContent = '$ ' + message;
    container.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, duration);
  };
}());

