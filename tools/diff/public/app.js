(function () {
  function computeDiff(oldText, newText) {
    var oldLines = oldText ? oldText.split('\n') : [];
    var newLines = newText ? newText.split('\n') : [];
    var results = [];

    var i = 0;
    var j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        results.push({ type: 'same', text: oldLines[i], oldLn: i + 1, newLn: j + 1 });
        i++;
        j++;
      } else if (j < newLines.length && (oldLines.indexOf(newLines[j], i) === -1 ? false : true)) {
        results.push({ type: 'del', text: oldLines[i], oldLn: i + 1, newLn: '' });
        i++;
      } else if (j < newLines.length && (oldLines.indexOf(newLines[j]) === -1 || oldLines.indexOf(newLines[j]) > i)) {
        results.push({ type: 'add', text: newLines[j], oldLn: '', newLn: j + 1 });
        j++;
      } else if (i < oldLines.length) {
        results.push({ type: 'del', text: oldLines[i], oldLn: i + 1, newLn: '' });
        i++;
      } else {
        results.push({ type: 'add', text: newLines[j], oldLn: '', newLn: j + 1 });
        j++;
      }
    }
    return results;
  }

  function runCompare() {
    var oldT = document.getElementById('text-old').value;
    var newT = document.getElementById('text-new').value;
    var diffs = computeDiff(oldT, newT);
    var container = document.getElementById('diff-container');
    container.textContent = '';

    if (diffs.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'mono';
      empty.style.padding = '1rem';
      empty.style.color = 'var(--muted)';
      empty.textContent = 'Inputs are empty.';
      container.appendChild(empty);
      return;
    }

    for (var k = 0; k < diffs.length; k++) {
      var d = diffs[k];
      var row = document.createElement('div');
      row.className = 'diff-line ' + d.type;

      var s1 = document.createElement('span');
      s1.className = 'diff-ln';
      s1.textContent = d.oldLn || '';

      var s2 = document.createElement('span');
      s2.className = 'diff-ln';
      s2.textContent = d.newLn || '';

      var sSign = document.createElement('span');
      sSign.style.userSelect = 'none';
      sSign.style.width = '15px';
      sSign.style.flexShrink = '0';
      sSign.textContent = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';

      var sText = document.createElement('span');
      sText.style.flex = '1';
      sText.style.minWidth = '0';
      sText.style.whiteSpace = 'pre-wrap';
      sText.style.wordBreak = 'break-word';
      sText.textContent = d.text;

      row.appendChild(s1);
      row.appendChild(s2);
      row.appendChild(sSign);
      row.appendChild(sText);
      container.appendChild(row);
    }
  }

  document.getElementById('btn-compare').addEventListener('click', runCompare);
  document.getElementById('btn-swap').addEventListener('click', function () {
    var o = document.getElementById('text-old');
    var n = document.getElementById('text-new');
    var tmp = o.value;
    o.value = n.value;
    n.value = tmp;
    runCompare();
  });
  document.getElementById('btn-clear').addEventListener('click', function () {
    document.getElementById('text-old').value = '';
    document.getElementById('text-new').value = '';
    var c = document.getElementById('diff-container');
    c.textContent = '';
    var div = document.createElement('div');
    div.className = 'mono';
    div.style.padding = '1rem';
    div.style.color = 'var(--muted)';
    div.textContent = 'Cleared.';
    c.appendChild(div);
  });

  document.getElementById('btn-share').addEventListener('click', async function () {
    var o = document.getElementById('text-old').value;
    var n = document.getElementById('text-new').value;
    if (!window.StateUrl) return;
    var token = await window.StateUrl.encodeState({ old: o, new: n });
    if (token) {
      window.location.hash = 'state=' + token;
    }
  });

  if (window.location.hash && window.StateUrl) {
    window.StateUrl.decodeState(window.location.hash).then(function (data) {
      if (data) {
        if (data.old) document.getElementById('text-old').value = data.old;
        if (data.new) document.getElementById('text-new').value = data.new;
        runCompare();
      }
    });
  }
})();
