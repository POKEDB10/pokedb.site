// scripts/audit-contrast.js
// Computes WCAG 2.1 contrast ratios for all 12 themes (Task P6.3, A11Y-001).

const THEMES = {
  'paper': {
    bg: '#f6f2e9',
    surface: '#fffdf8',
    text: '#1d1b19',
    muted: '#5e564d',
    accent: '#bf3b2d',
    accentText: '#ffffff'
  },
  'matrix': {
    bg: '#07100b',
    surface: '#0c1911',
    text: '#e8fff0',
    muted: '#8cb79a',
    accent: '#56f49a',
    accentText: '#07100b'
  },
  'cyberpunk': {
    bg: '#091016',
    surface: '#101c26',
    text: '#e6f8ff',
    muted: '#94b4c1',
    accent: '#35e6ff',
    accentText: '#061014'
  },
  'synthwave': {
    bg: '#160d28',
    surface: '#251743',
    text: '#fff2fa',
    muted: '#bea2d8',
    accent: '#ff579b',
    accentText: '#130924'
  },
  'nordic-ice': {
    bg: '#101923',
    surface: '#172637',
    text: '#eef8ff',
    muted: '#9db7c8',
    accent: '#72d6ff',
    accentText: '#10202d'
  },
  'dracula-neon': {
    bg: '#181826',
    surface: '#242438',
    text: '#fbf9ff',
    muted: '#b7b3ce',
    accent: '#bd87ff',
    accentText: '#1c1626'
  },
  'gruvbox-retro': {
    bg: '#1d2021',
    surface: '#292827',
    text: '#f7ebc6',
    muted: '#c3af84',
    accent: '#f6a23d',
    accentText: '#221b13'
  },
  'emerald-forest': {
    bg: '#07130e',
    surface: '#10251b',
    text: '#ebfff4',
    muted: '#9fc8ae',
    accent: '#4de4a5',
    accentText: '#06140d'
  },
  'sunset-amber': {
    bg: '#1c1115',
    surface: '#2a191d',
    text: '#fff3ee',
    muted: '#d8aaa0',
    accent: '#ff9362',
    accentText: '#2a1111'
  },
  'solarized-gold': {
    bg: '#002530',
    surface: '#053440',
    text: '#fff9df',
    muted: '#b7c7ae',
    accent: '#f2c94c',
    accentText: '#18220a'
  },
  'oled-black': {
    bg: '#070708',
    surface: '#111114',
    text: '#fbfbfd',
    muted: '#a09fa9',
    accent: '#8d7cff',
    accentText: '#070708'
  },
  'tokyo-neon': {
    bg: '#171826',
    surface: '#21233a',
    text: '#d9e1ff',
    muted: '#a7b5eb',
    accent: '#ff879c',
    accentText: '#2a1420'
  }
};

function hexToRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]) {
  const [sR, sG, sB] = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function runAudit() {
  console.log('=======================================================');
  console.log('WCAG 2.1 Contrast Ratio Audit across all 12 Themes');
  console.log('=======================================================\n');

  let totalChecks = 0;
  let failures = 0;

  for (const [name, tokens] of Object.entries(THEMES)) {
    console.log(`Checking Theme: ${name}`);

    // 1. text on bg >= 4.5:1
    const textOnBg = contrastRatio(tokens.text, tokens.bg);
    totalChecks++;
    if (textOnBg < 4.5) {
      console.error(`  [FAIL] text on bg: ${textOnBg.toFixed(2)}:1 (minimum 4.5:1)`);
      failures++;
    } else {
      console.log(`  [PASS] text on bg: ${textOnBg.toFixed(2)}:1`);
    }

    // 2. text on surface >= 4.5:1
    const textOnSurface = contrastRatio(tokens.text, tokens.surface);
    totalChecks++;
    if (textOnSurface < 4.5) {
      console.error(`  [FAIL] text on surface: ${textOnSurface.toFixed(2)}:1 (minimum 4.5:1)`);
      failures++;
    } else {
      console.log(`  [PASS] text on surface: ${textOnSurface.toFixed(2)}:1`);
    }

    // 3. muted on bg >= 4.5:1 (or 3.0:1 for secondary UI)
    const mutedOnBg = contrastRatio(tokens.muted, tokens.bg);
    totalChecks++;
    if (mutedOnBg < 4.5) {
      console.error(`  [FAIL] muted on bg: ${mutedOnBg.toFixed(2)}:1 (minimum 4.5:1)`);
      failures++;
    } else {
      console.log(`  [PASS] muted on bg: ${mutedOnBg.toFixed(2)}:1`);
    }

    // 4. accent on bg >= 3.0:1 (UI components / graphical objects)
    const accentOnBg = contrastRatio(tokens.accent, tokens.bg);
    totalChecks++;
    if (accentOnBg < 3.0) {
      console.error(`  [FAIL] accent on bg: ${accentOnBg.toFixed(2)}:1 (minimum 3.0:1)`);
      failures++;
    } else {
      console.log(`  [PASS] accent on bg: ${accentOnBg.toFixed(2)}:1`);
    }

    // 5. accentText on accent >= 4.5:1 (button text on button background)
    const buttonContrast = contrastRatio(tokens.accentText, tokens.accent);
    totalChecks++;
    if (buttonContrast < 4.5) {
      console.error(`  [FAIL] button text on accent: ${buttonContrast.toFixed(2)}:1 (minimum 4.5:1)`);
      failures++;
    } else {
      console.log(`  [PASS] button text on accent: ${buttonContrast.toFixed(2)}:1`);
    }

    console.log('');
  }

  console.log(`Audit Summary: ${totalChecks - failures}/${totalChecks} checks passed.`);
  if (failures > 0) {
    console.error(`FAILED: ${failures} contrast violations found.`);
    process.exit(1);
  } else {
    console.log('SUCCESS: All 12 themes meet WCAG contrast requirements with 0 failures.');
  }
}

if (require.main === module) {
  runAudit();
}

module.exports = {
  THEMES,
  contrastRatio,
  runAudit
};
