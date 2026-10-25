// Export the diagram as a standalone SVG or a PNG. Fonts are embedded as data
// URLs so the file looks the same when opened elsewhere.

async function fontFaceCSS(families) {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const fam = r.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
      if (!families.includes(fam)) continue;
      const range = r.style.getPropertyValue('unicode-range');
      if (range && !/U\+0+-0*FF(?![0-9A-F])/i.test(range)) continue; // latin only keeps files small
      const src = r.style.getPropertyValue('src');
      const face = (url) => `@font-face{font-family:'${fam}';font-style:${r.style.getPropertyValue('font-style') || 'normal'};font-weight:${r.style.getPropertyValue('font-weight') || 400};src:url(${url}) format('woff2');}`;
      // built pages carry the fonts inline already
      const inline = /url\(["']?(data:[^"')]+)["']?\)/.exec(src);
      if (inline) { out.push(face(inline[1])); continue; }
      const m = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(src);
      if (!m) continue;
      try {
        const buf = await (await fetch(new URL(m[1], sheet.href || location.href))).arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out.push(face(`data:font/woff2;base64,${btoa(bin)}`));
      } catch { /* leave the font out */ }
    }
  }
  return out.join('\n');
}

async function standalone(svg, background) {
  const clone = svg.cloneNode(true);
  clone.querySelector('.hits')?.remove();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const [x, y, w, h] = clone.getAttribute('viewBox').split(/\s+/).map(Number);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  Object.entries({ x, y, width: w, height: h, fill: background }).forEach(([k, v]) => bg.setAttribute(k, v));
  clone.insertBefore(bg, clone.firstChild);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  const used = new Set([...clone.querySelectorAll('[font-family]')].map((n) => n.getAttribute('font-family').split(',')[0].replace(/['"]/g, '').trim()));
  style.textContent = await fontFaceCSS([...used]);
  clone.insertBefore(style, clone.firstChild);
  for (const n of clone.querySelectorAll('.wg')) n.removeAttribute('style');
  for (const n of clone.querySelectorAll('[fill^="var("]')) n.setAttribute('fill', background);
  clone.querySelectorAll('[style*="stroke-dash"]').forEach((n) => n.style.removeProperty('stroke-dasharray'));
  return { text: new XMLSerializer().serializeToString(clone), w, h };
}

/** Save through a plain link; only works when the page isn't sandboxed. */
export function downloadLink(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function fileName(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sentence';
  return `diagram-${slug}`;
}

export async function svgBlob(svg, background) {
  const { text } = await standalone(svg, background);
  return new Blob([text], { type: 'image/svg+xml' });
}

export async function pngBlob(svg, background, scale = 2) {
  const { text, w, h } = await standalone(svg, background);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}
