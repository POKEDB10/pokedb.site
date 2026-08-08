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
  if (!cards.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    cards.forEach(function (card) { card.classList.add('is-visible'); });
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  cards.forEach(function (card) { observer.observe(card); });
}());
