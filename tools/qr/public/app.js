(function () {
  var activeTab = 'url';
  var activeText = 'https://pokedb.site';
  var isGenerated = false;
  var uploadedLogoDataUrl = null;
  var lastCompositeDataUrl = null;

  function getActivePayload() {
    if (activeTab === 'url') {
      var val = document.getElementById('url-input').value.trim();
      return val || 'https://pokedb.site';
    }
    if (activeTab === 'wifi') {
      var ssid = document.getElementById('wifi-ssid').value.trim();
      var pass = document.getElementById('wifi-pass').value.trim();
      var type = document.getElementById('wifi-type').value;
      if (!ssid) return 'WIFI:S:MyNetwork;;';
      return 'WIFI:S:' + ssid + ';T:' + type + ';P:' + pass + ';;';
    }
    if (activeTab === 'email') {
      var to = document.getElementById('email-to').value.trim();
      var sub = document.getElementById('email-subject').value.trim();
      if (!to) return 'mailto:hello@pokedb.site';
      return 'mailto:' + to + (sub ? '?subject=' + encodeURIComponent(sub) : '');
    }
    return 'https://pokedb.site';
  }

  function getStyleOptions() {
    var fgPreset = document.getElementById('fg-color-preset').value;
    var bgPreset = document.getElementById('bg-color-preset').value;

    var dark = '#000000';
    if (fgPreset === 'theme') {
      var cs = getComputedStyle(document.documentElement);
      dark = cs.getPropertyValue('--accent').trim() || '#6366F1';
    } else if (fgPreset === 'custom') {
      dark = document.getElementById('custom-fg-picker').value || '#000000';
    } else {
      dark = fgPreset;
    }

    var light = '#ffffff';
    if (bgPreset === 'custom') {
      light = document.getElementById('custom-bg-picker').value || '#ffffff';
    } else {
      light = bgPreset;
    }

    return {
      dark: dark,
      light: light
    };
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  async function generateAndShowQr(e) {
    if (e && e.preventDefault) e.preventDefault();

    activeText = getActivePayload();
    var opts = getStyleOptions();
    var wrapper = document.getElementById('studio-wrapper');
    var previewCol = document.getElementById('preview-col');
    var imgEl = document.getElementById('qr-preview-img');
    var frame = document.getElementById('qr-frame-box');
    var genBtn = document.getElementById('generate-btn');
    var emblemChoice = document.getElementById('emblem-option').value;

    // 1. Expand layout and show right column IMMEDIATELY
    if (!isGenerated) {
      isGenerated = true;
      wrapper.classList.add('is-generated');
      previewCol.classList.add('is-visible');
      genBtn.textContent = '$ qr --update (Re-generate QR Code)';
    }

    // 2. Update frame background
    if (opts.light && opts.light !== 'transparent') {
      frame.style.background = opts.light;
    } else {
      frame.style.background = '#ffffff';
    }

    // 3. Generate the live preview locally; the API is reserved for exports.
    try {
      if (!window.QRCodeLib || typeof window.QRCodeLib.generateDataURL !== 'function') return;
      var dataUrl = window.QRCodeLib.generateDataURL(activeText, {
        dark: opts.dark,
        light: opts.light,
        margin: 1
      });
      if (!dataUrl) return;

      // 4. Composite Center Emblem using HTML5 Canvas (600x600)
      var canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 600;
      var ctx = canvas.getContext('2d');

      var baseImg = new Image();
      baseImg.onload = function () {
        ctx.drawImage(baseImg, 0, 0, 600, 600);

        function finishComposite() {
          lastCompositeDataUrl = canvas.toDataURL('image/png');
          imgEl.src = lastCompositeDataUrl;

          // Trigger popIn animation
          imgEl.style.animation = 'none';
          imgEl.offsetHeight; /* trigger reflow */
          imgEl.style.animation = 'popIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        }

        if (emblemChoice === 'none') {
          finishComposite();
          return;
        }

        // Center protective background frame
        var padSize = 148;
        var px = 300 - padSize / 2;
        var py = 300 - padSize / 2;

        if (emblemChoice === 'p10_logo') {
          // 1) OUR P10 LOGO
          ctx.fillStyle = '#14151C';
          ctx.strokeStyle = opts.dark === '#000000' ? '#6366F1' : opts.dark;
          ctx.lineWidth = 5;
          drawRoundedRect(ctx, px, py, padSize, padSize, 22);
          ctx.fill();
          ctx.stroke();

          // Text P10
          ctx.font = '700 52px "IBM Plex Mono", monospace';
          ctx.fillStyle = '#ECE7DA';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P10', 300, 304);
          finishComposite();
        } else if (emblemChoice === 'emoji') {
          // 2) ANY EMOJI
          ctx.fillStyle = opts.light && opts.light !== 'transparent' ? opts.light : '#ffffff';
          ctx.strokeStyle = opts.dark;
          ctx.lineWidth = 4;
          drawRoundedRect(ctx, px, py, padSize, padSize, 20);
          ctx.fill();
          ctx.stroke();

          var emojiText = document.getElementById('emoji-input').value.trim() || '⚡';
          ctx.font = '58px sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emojiText, 300, 305);
          finishComposite();
        } else if (emblemChoice === 'custom_pic' && uploadedLogoDataUrl) {
          // 3) CUSTOM PICTURE UPLOAD
          ctx.fillStyle = opts.light && opts.light !== 'transparent' ? opts.light : '#ffffff';
          ctx.strokeStyle = opts.dark;
          ctx.lineWidth = 4;
          drawRoundedRect(ctx, px, py, padSize, padSize, 20);
          ctx.fill();
          ctx.stroke();

          var logoImg = new Image();
          logoImg.onload = function () {
            var logoSize = 120;
            var lx = 300 - logoSize / 2;
            var ly = 300 - logoSize / 2;

            // Clip image to rounded rectangle inside box
            ctx.save();
            drawRoundedRect(ctx, lx, ly, logoSize, logoSize, 14);
            ctx.clip();
            ctx.drawImage(logoImg, lx, ly, logoSize, logoSize);
            ctx.restore();
            finishComposite();
          };
          logoImg.onerror = finishComposite;
          logoImg.src = uploadedLogoDataUrl;
        } else {
          finishComposite();
        }
      };
      baseImg.src = dataUrl;

    } catch (err) {
      console.error('Error in generateAndShowQr:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.querySelectorAll('.tab-btn');
    var genBtn = document.getElementById('generate-btn');
    var fgPreset = document.getElementById('fg-color-preset');
    var bgPreset = document.getElementById('bg-color-preset');
    var emblemOptionSelect = document.getElementById('emblem-option');
    var logoFileInput = document.getElementById('logo-file-input');
    var logoStatus = document.getElementById('logo-status');

    // Tab Switching
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        tabs.forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        activeTab = tab.getAttribute('data-tab');

        document.getElementById('tab-content-url').style.display = activeTab === 'url' ? 'block' : 'none';
        document.getElementById('tab-content-wifi').style.display = activeTab === 'wifi' ? 'block' : 'none';
        document.getElementById('tab-content-email').style.display = activeTab === 'email' ? 'block' : 'none';
      });
    });

    // Emblem Option selector toggle
    emblemOptionSelect.addEventListener('change', function () {
      var val = emblemOptionSelect.value;
      document.getElementById('emoji-input-wrap').style.display = val === 'emoji' ? 'block' : 'none';
      document.getElementById('custom-logo-wrap').style.display = val === 'custom_pic' ? 'block' : 'none';
    });

    // Custom Logo File Reader
    logoFileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (evt) {
        uploadedLogoDataUrl = evt.target.result;
        logoStatus.textContent = '✓ Loaded: ' + file.name;
        logoStatus.style.display = 'block';
      };
      reader.readAsDataURL(file);
    });

    // Custom color picker toggles
    fgPreset.addEventListener('change', function () {
      document.getElementById('custom-fg-wrap').style.display = fgPreset.value === 'custom' ? 'block' : 'none';
    });

    bgPreset.addEventListener('change', function () {
      document.getElementById('custom-bg-wrap').style.display = bgPreset.value === 'custom' ? 'block' : 'none';
    });

    // Color Pickers sync
    var customFgPicker = document.getElementById('custom-fg-picker');
    var customFgText = document.getElementById('custom-fg-text');
    customFgPicker.addEventListener('input', function () { customFgText.value = customFgPicker.value; });
    customFgText.addEventListener('input', function () {
      if (/^#[0-9A-Fa-f]{6}$/.test(customFgText.value)) { customFgPicker.value = customFgText.value; }
    });

    var customBgPicker = document.getElementById('custom-bg-picker');
    var customBgText = document.getElementById('custom-bg-text');
    customBgPicker.addEventListener('input', function () { customBgText.value = customBgPicker.value; });
    customBgText.addEventListener('input', function () {
      if (/^#[0-9A-Fa-f]{6}$/.test(customBgText.value)) { customBgPicker.value = customBgText.value; }
    });

    // CLICK GENERATE BUTTON
    if (genBtn) {
      genBtn.addEventListener('click', generateAndShowQr);
    }

    // Export PNG Download Handler
    document.getElementById('export-png-btn').addEventListener('click', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!lastCompositeDataUrl) return alert('Please click Generate QR Code first.');

      var link = document.createElement('a');
      link.href = lastCompositeDataUrl;
      link.download = 'qrcode-p10.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    // Export SVG Download Handler
    document.getElementById('export-svg-btn').addEventListener('click', async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!lastCompositeDataUrl) return alert('Please click Generate QR Code first.');

      try {
        var opts = getStyleOptions();
        var url = '/api/qr?format=svg&download=1&text=' + encodeURIComponent(activeText) +
          '&dark=' + encodeURIComponent(opts.dark) + '&light=' + encodeURIComponent(opts.light);
        var response = await fetch(url);
        if (!response.ok) throw new Error('SVG export failed');
        var blobUrl = URL.createObjectURL(await response.blob());
        var link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'qrcode.svg';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        alert('Unable to export SVG. Please try again.');
      }
    });

    // Re-render if generated and theme changes
    window.addEventListener('themeChanged', function () {
      if (isGenerated) generateAndShowQr();
    });
  });
})();
