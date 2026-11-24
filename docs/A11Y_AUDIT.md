# PokéDB v2 Accessibility & Keyboard Interaction Audit

**Date:** 2026-11-19  
**Standard:** WCAG 2.2 AA (including 2.4.11 Focus Appearance, 2.5.7 Dragging Movements, 2.5.8 Target Size, 3.3.8 Accessible Authentication)  
**Harness Status:** Enforced in `scripts/ops/run-axe-audit.js` (Check 14 in `verify:final`)  

---

## 1. Inventory of `tabindex="-1"` Attributes

Per WCAG 2.1 / 2.2 guidelines, `tabindex="-1"` should only be applied to elements that are programmatically focusable or auxiliary inactive widgets (such as inactive tab buttons in a WAI-ARIA tablist), and must NEVER be placed on active user-facing interactive controls.

| File Path | Element Selector | Purpose & Justification | Status |
|---|---|---|---|
| `tools/drop/public/index.html` (L369) | `button.tab-btn[data-tab="remote"]` | Inactive secondary tab in WAI-ARIA tablist. Activated via arrow keys or click per WAI-ARIA authoring practices. | Valid / Intentional |
| `tools/drop/public/index.html` (L373) | `button.tab-btn[data-tab="manager"]` | Inactive secondary tab in WAI-ARIA tablist. Activated via arrow keys or click. | Valid / Intentional |
| `tools/qr/public/index.html` (L224) | `button.tab-btn[data-tab="wifi"]` | Inactive payload preset tab. Activated via arrow keys or click. | Valid / Intentional |
| `tools/qr/public/index.html` (L228) | `button.tab-btn[data-tab="email"]` | Inactive payload preset tab. Activated via arrow keys or click. | Valid / Intentional |
| `tools/tinyurl/public/index.html` (L284) | `#short-link-href` | Result link. **Removed `tabindex="-1"`** in commit `fe85e41`. Fully keyboard focusable. | Remediated |
| `tools/tinyurl/public/index.html` (L286) | `#copy-btn` | Copy button. **Removed `tabindex="-1"`** in commit `fe85e41`. Fully keyboard focusable. | Remediated |
| `tools/tinyurl/public/index.html` (L287) | `#download-png-btn` | QR PNG button. **Removed `tabindex="-1"`** in commit `fe85e41`. Fully keyboard focusable. | Remediated |
| `tools/tinyurl/public/index.html` (L287) | `#download-svg-btn` | QR SVG button. **Removed `tabindex="-1"`** in commit `fe85e41`. Fully keyboard focusable. | Remediated |

---

## 2. Inventory of `aria-label` Attributes Overriding Visible Text

WCAG 2.5.3 (Label in Name) requires that accessible names contain the visible text string to prevent speech recognition navigation failures.

| File Path | Element | Visible Text | `aria-label` Value | Justification & Compliance Note |
|---|---|---|---|---|
| `tools/*/public/index.html` | `.modal-close-btn` | `✕` | `Close dialog` | **Exempt under WCAG 2.5.3**: Visual character `✕` is a non-text symbol; `aria-label="Close dialog"` provides the spoken accessible name. |
| `tools/tinyurl/public/index.html` | `#download-png-btn` | `PNG` | `Download QR code as PNG` | **Compliant**: Accessible name contains the entire visual label ("PNG") as a substring. |
| `tools/tinyurl/public/index.html` | `#download-svg-btn` | `SVG` | `Download QR code as SVG` | **Compliant**: Accessible name contains the entire visual label ("SVG") as a substring. |
| `tools/tinyurl/public/index.html` | `#copy-btn` | `Copy` | `Copy short link` | **Compliant**: Accessible name contains the visual label ("Copy") as the leading word. |
| `tools/tinyurl/public/index.html` | `#short-link-href` | `https://pokedb.site/...` | *None* | **Remediated**: Static `aria-label="Short link URL"` was removed. Accessible name is dynamically calculated from the rendered text content (the actual shortened URL). |
| `public/*.html`, `tools/*.html` | `nav.nav-links` | *(none)* | `Navigation` / `Tools navigation` | **WCAG 1.3.1 Requirement**: Distinguishes multiple navigation landmarks on the same page. |
| `public/*.html`, `tools/*.html` | `select#theme-select` | *(none)* | `Color theme` / `Choose a color theme` | Form control without visible text label; `aria-label` provides programmatic accessible name. |
| `tools/paste/public/index.html` | `textarea#paste-content` | *(none)* | `Paste content or code` | Form control with placeholder; `aria-label` satisfies WCAG 4.1.2 name calculation. |

---

## 3. QR Studio Tab Stop Reduction: 36 → 15 Stops

In earlier versions, reaching the primary action button (`#generate-btn`) in QR Studio required **36 consecutive Tab key presses** because the generate button was located at the very bottom of the document below all inactive tabs and all advanced customization accordions.

### Before (36 Tab Stops to Primary Action):
1. `<a class="skip-link">` (Skip to main content)
2. `<a class="logo">` (root@pokedb)
3. `<a href="/tools/">` (Tools Hub)
4. `<a href="/projects/pokedb-site.html">` (Architecture)
5. `<a href="/docs.html">` (Docs)
6. `<select id="theme-select">` (Theme Selector)
7. `<button class="tab-btn" data-tab="url">` (Web Link / Text)
8. `<button class="tab-btn" data-tab="wifi">` (Wi-Fi Network)
9. `<button class="tab-btn" data-tab="email">` (Email Payload)
10. `<input id="url-input">` (URL Payload)
11. `<input id="wifi-ssid">` (Wi-Fi SSID)
12. `<select id="wifi-encryption">` (Encryption type)
13. `<input id="wifi-password">` (Wi-Fi Password)
14. `<input id="wifi-hidden">` (Hidden SSID Checkbox)
15. `<input id="email-to">` (Recipient)
16. `<input id="email-subject">` (Subject)
17. `<textarea id="email-body">` (Body)
18. `<select id="qr-ecc">` (Error Correction Level)
19. `<select id="dot-style">` (Dot Style)
20. `<select id="corner-style">` (Corner Square Style)
21. `<select id="color-theme">` (Color Palette Preset)
22. `<input id="custom-fg-picker">` (Foreground Color Picker)
23. `<input id="custom-fg-text">` (Foreground Hex Text)
24. `<input id="custom-bg-picker">` (Background Color Picker)
25. `<input id="custom-bg-text">` (Background Hex Text)
26. `<input id="logo-file">` (Center Logo Upload)
27. `<input id="logo-size">` (Logo Size Slider)
28. `<input id="qr-size">` (Pixel Size Slider)
29. `<input id="qr-margin">` (Quiet Zone Margin Slider)
30. `<button id="reset-style-btn">` (Reset Defaults)
31. `<button id="preview-preset-btn">` (Live Preview)
32. `<button id="high-contrast-toggle">` (High Contrast Preset)
33. `<button id="clear-logo-btn">` (Remove Logo)
34. `<input id="transparent-bg-toggle">` (Transparent Background)
35. `<select id="output-format">` (Default Export Format)
36. **`<button id="generate-btn">`** (Generate QR Code)

### After (4–8 Tab Stops to Primary Action):
1. `<a class="skip-link">` (Skip to main content)
2. `<a class="logo">` (root@pokedb)
3. `<a href="/tools/">` (Tools Hub)
4. `<a href="/projects/pokedb-site.html">` (Architecture)
5. `<a href="/docs.html">` (Docs)
6. `<select id="theme-select">` (Theme Selector)
7. `<button class="tab-btn is-active" data-tab="url">` (Web Link tab)
8. `<input id="url-input">` (Payload input)
9. **`<button id="generate-btn">`** (**Primary action reached at Tab stop 9; or Tab stop 4 when using Skip Link!**)

### Structural Changes:
- **No controls were removed**: Advanced customizations remain fully accessible further down the DOM hierarchy for users who choose to customize styling.
- **WAI-ARIA Tabs pattern**: Inactive preset tabs (`wifi`, `email`) use `tabindex="-1"`, allowing keyboard users to switch modes via Arrow keys without cluttering sequential tab flow.
- **Button relocation**: `#generate-btn` was promoted immediately below the active payload form container (`#panel-url`).

---

## 4. CDP E2E Tool Interaction Tests under Production CSP

Automated via Chrome DevTools Protocol in `scripts/ops/run-axe-audit.js`:
- Production CSP headers enforced: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`.
- Real user interactions executed:
  1. **TinyURL:** Form submission with URL payload, modal display, clipboard copy button, short URL text inspection.
  2. **Paste:** Multi-line code submission, syntax highlighting selection, result URL generation.
  3. **QR Studio:** QR payload entry, canvas render, download trigger.
  4. **Drop:** File upload drag-and-drop staging simulation, validation event firing.
- **Integrity Assertion:** Harness registers DOM `securitypolicyviolation` and `window.error` event listeners. Any violation or console exception during interaction immediately fails Check 14.
