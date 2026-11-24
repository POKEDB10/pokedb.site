(function () {
  function explainField(val, name) {
    if (val === '*') return 'every ' + name;
    if (val.indexOf('*/') === 0) return 'every ' + val.slice(2) + ' ' + name + 's';
    if (val.indexOf(',') !== -1) return 'at ' + name + 's ' + val;
    if (val.indexOf('-') !== -1) return 'from ' + name + ' ' + val;
    return 'at ' + name + ' ' + val;
  }

  function matchesCronField(val, expr, min, max, isDow) {
    var parts = expr.split(',');
    for (var p = 0; p < parts.length; p++) {
      var token = parts[p].trim();
      var step = 1;
      var rangePart = token;
      if (token.indexOf('/') !== -1) {
        var sp = token.split('/');
        rangePart = sp[0];
        step = parseInt(sp[1], 10) || 1;
      }
      var lo = min;
      var hi = max;
      if (rangePart !== '*') {
        if (rangePart.indexOf('-') !== -1) {
          var rp = rangePart.split('-');
          lo = parseInt(rp[0], 10);
          hi = parseInt(rp[1], 10);
        } else {
          lo = parseInt(rangePart, 10);
          hi = lo;
        }
      }
      if (isDow && val === 0 && (lo === 7 || hi === 7)) return true;
      for (var n = lo; n <= hi; n += step) {
        var check = isDow ? (n % 7) : n;
        if (check === val) return true;
      }
    }
    return false;
  }

  function computeNextRuns(parts, count) {
    var runs = [];
    var cursor = new Date();
    cursor.setUTCSeconds(0, 0);
    cursor = new Date(cursor.getTime() + 60000);
    var limit = 60 * 24 * 60; // search up to 60 days ahead
    for (var i = 0; i < limit && runs.length < count; i++) {
      var m = cursor.getUTCMinutes();
      var h = cursor.getUTCHours();
      var dom = cursor.getUTCDate();
      var mon = cursor.getUTCMonth() + 1;
      var dow = cursor.getUTCDay();
      if (
        matchesCronField(m, parts[0], 0, 59, false) &&
        matchesCronField(h, parts[1], 0, 23, false) &&
        matchesCronField(dom, parts[2], 1, 31, false) &&
        matchesCronField(mon, parts[3], 1, 12, false) &&
        matchesCronField(dow, parts[4], 0, 7, true)
      ) {
        runs.push(new Date(cursor.getTime()));
      }
      cursor = new Date(cursor.getTime() + 60000);
    }
    return runs;
  }

  function explainCron() {
    var raw = document.getElementById('cron-input').value.trim();
    var parts = raw.split(/\s+/);
    var humanEl = document.getElementById('cron-human');
    if (parts.length !== 5) {
      humanEl.textContent = 'Please enter exactly 5 fields separated by spaces.';
      humanEl.style.color = 'var(--danger)';
      return;
    }
    humanEl.style.color = 'var(--text)';

    document.getElementById('f-min').textContent = parts[0];
    document.getElementById('f-hour').textContent = parts[1];
    document.getElementById('f-dom').textContent = parts[2];
    document.getElementById('f-mon').textContent = parts[3];
    document.getElementById('f-dow').textContent = parts[4];

    var desc = 'Runs ';
    if (parts[0] === '*' && parts[1] === '*') desc += 'every minute';
    else if (parts[0].indexOf('*/') === 0 && parts[1] === '*') desc += 'every ' + parts[0].slice(2) + ' minutes';
    else if (parts[0] === '0' && parts[1] === '*') desc += 'every hour on the hour';
    else if (parts[0] === '0' && parts[1] === '0') desc += 'every day at midnight (00:00 UTC)';
    else {
      desc += explainField(parts[0], 'minute') + ', ' +
        explainField(parts[1], 'hour') + ', ' +
        explainField(parts[2], 'day-of-month') + ', ' +
        explainField(parts[3], 'month') + ', ' +
        explainField(parts[4], 'day-of-week');
    }

    humanEl.textContent = desc;

    var runsList = document.getElementById('cron-runs');
    runsList.textContent = '';
    var nextRuns = computeNextRuns(parts, 5);
    if (nextRuns.length === 0) {
      var emptyLi = document.createElement('li');
      emptyLi.textContent = 'No matching execution within the next 60 days.';
      runsList.appendChild(emptyLi);
    } else {
      for (var i = 0; i < nextRuns.length; i++) {
        var li = document.createElement('li');
        li.textContent = nextRuns[i].toUTCString();
        runsList.appendChild(li);
      }
    }
  }

  document.querySelectorAll('[data-cron]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById('cron-input').value = btn.getAttribute('data-cron');
      explainCron();
    });
  });

  document.getElementById('cron-input').addEventListener('input', explainCron);

  document.getElementById('btn-share').addEventListener('click', async function () {
    var val = document.getElementById('cron-input').value.trim();
    if (!val || !window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ cron: val });
    if (token) {
      window.location.hash = 'state=' + token;
    }
  });

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data && data.cron) {
        document.getElementById('cron-input').value = data.cron;
        explainCron();
      }
    });
  }

  explainCron();
})();
