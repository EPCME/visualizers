// Engraved score via Verovio (loaded from a CDN on first use), with click and box selection of notes.

const VEROVIO = 'https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist';
let toolkitPromise = null;

function loadToolkit() {
  toolkitPromise ??= (async () => {
    const [{ default: createModule }, { VerovioToolkit }] = await Promise.all([
      import(`${VEROVIO}/verovio-module.mjs`),
      import(`${VEROVIO}/verovio.mjs`),
    ]);
    return new VerovioToolkit(await createModule());
  })();
  return toolkitPromise;
}

// Verovio zoom, in percent: bigger on narrow screens so notes are big enough to tap.
const scaleFor = (width) => (width < 500 ? 46 : width < 800 ? 42 : 38);

/**
 * Mount an engraver into `container`.
 * `onSelect(ids: Set<string>)` fires whenever the selection changes.
 * Returns { render(xml), setSelection(ids), highlight(ids|null) }.
 */
export function mountEngraver(container, { onSelect, onStatus }) {
  let xml = null;
  let selected = new Set();
  let lastWidth = 0;
  let renderToken = 0;

  const pages = document.createElement('div');
  pages.className = 'pages';
  const band = document.createElement('div');
  band.className = 'band';
  band.hidden = true;
  container.append(pages, band);

  function paint() {
    for (const g of pages.querySelectorAll('g.note')) g.classList.toggle('sel', selected.has(g.id));
  }

  async function render(newXml = xml) {
    xml = newXml;
    if (!xml) return;
    const token = ++renderToken;
    onStatus?.('Engraving…');
    let tk;
    try {
      tk = await loadToolkit();
    } catch {
      onStatus?.('Couldn\'t load the engraving library (Verovio). The mapped view below still works.', 'error');
      return;
    }
    if (token !== renderToken) return;
    const width = Math.max(320, container.clientWidth);
    lastWidth = width;
    tk.setOptions({
      pageWidth: Math.round((width * 100) / scaleFor(width)),
      scale: scaleFor(width),
      adjustPageHeight: true,
      pageMarginTop: 40, pageMarginBottom: 40, pageMarginLeft: 20, pageMarginRight: 20,
      footer: 'none',
      header: 'none', // the page already shows the title
      svgViewBox: true,
    });
    if (!tk.loadData(xml)) {
      onStatus?.('Verovio couldn\'t engrave this score. The mapped view below still works.', 'error');
      return;
    }
    const n = tk.getPageCount();
    const html = [];
    for (let i = 1; i <= n; i++) html.push(tk.renderToSVG(i));
    pages.innerHTML = html.join('');
    paint();
    onStatus?.('');
  }

  // Re-engrave when the available width changes enough to matter.
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (xml && Math.abs(container.clientWidth - lastWidth) > 40) render();
    }, 250);
  }).observe(container);

  const changed = () => { paint(); onSelect(new Set(selected)); };

  // Selection. Mouse: click toggles the nearest note, drag draws a box that adds notes.
  // Touch: tap toggles the nearest note (generous radius for fingers); with box mode on, drag draws a box.
  let boxMode = false;
  let drag = null;

  const noteRects = () => [...pages.querySelectorAll('g.note')].map((g) => ({ g, r: (g.querySelector('.notehead') ?? g).getBoundingClientRect() }));

  function nearestNote(x, y, radius) {
    let best = null;
    let bestD = radius;
    for (const { g, r } of noteRects()) {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= bestD) { best = g; bestD = d; }
    }
    return best;
  }

  function toggle(g) {
    if (selected.has(g.id)) selected.delete(g.id);
    else selected.add(g.id);
    changed();
  }

  pages.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, touch, canBox: !touch || boxMode };
    if (drag.canBox) pages.setPointerCapture?.(e.pointerId);
  });
  pages.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < (drag.touch ? 10 : 6)) return;
    drag.moved = true;
    if (!drag.canBox) return; // touch without box mode: let the page scroll
    e.preventDefault();
    const r = container.getBoundingClientRect();
    Object.assign(band.style, {
      left: `${Math.min(e.clientX, drag.x) - r.left + container.scrollLeft}px`,
      top: `${Math.min(e.clientY, drag.y) - r.top + container.scrollTop}px`,
      width: `${Math.abs(dx)}px`,
      height: `${Math.abs(dy)}px`,
    });
    band.hidden = false;
  });
  const finish = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    band.hidden = true;
    if (cancelled) return;
    if (d.moved) {
      if (!d.canBox) return;
      const box = { l: Math.min(e.clientX, d.x), r: Math.max(e.clientX, d.x), t: Math.min(e.clientY, d.y), b: Math.max(e.clientY, d.y) };
      let added = 0;
      for (const { g, r: nb } of noteRects()) {
        if (nb.right >= box.l && nb.left <= box.r && nb.bottom >= box.t && nb.top <= box.b && !selected.has(g.id)) {
          selected.add(g.id);
          added++;
        }
      }
      if (added) changed();
      return;
    }
    const g = nearestNote(e.clientX, e.clientY, d.touch ? 24 : 10);
    if (g) toggle(g);
  };
  pages.addEventListener('pointerup', (e) => finish(e, false));
  pages.addEventListener('pointercancel', (e) => finish(e, true));

  function setBoxMode(on) {
    boxMode = on;
    container.classList.toggle('box-mode', on);
  }

  return {
    render,
    setBoxMode,
    setSelection(ids) { selected = new Set(ids); paint(); },
    highlight(ids) {
      for (const g of pages.querySelectorAll('g.note.hl')) g.classList.remove('hl');
      if (!ids) return;
      for (const id of ids) {
        const g = pages.querySelector(`g.note[id="${CSS.escape(id)}"]`);
        g?.classList.add('hl');
      }
    },
  };
}
