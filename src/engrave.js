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

const SCALE = 38; // Verovio zoom, in percent

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
      pageWidth: Math.round((width * 100) / SCALE),
      scale: SCALE,
      adjustPageHeight: true,
      pageMarginTop: 40, pageMarginBottom: 40, pageMarginLeft: 20, pageMarginRight: 20,
      footer: 'none',
      header: 'auto',
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

  // Click a note to toggle it; drag a box to add every note it touches.
  let drag = null;
  pages.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; pages.setPointerCapture?.(e.pointerId); }
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
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    band.hidden = true;
    if (d.moved) {
      const box = { l: Math.min(e.clientX, d.x), r: Math.max(e.clientX, d.x), t: Math.min(e.clientY, d.y), b: Math.max(e.clientY, d.y) };
      let added = 0;
      for (const g of pages.querySelectorAll('g.note')) {
        const nb = (g.querySelector('.notehead') ?? g).getBoundingClientRect();
        if (nb.right >= box.l && nb.left <= box.r && nb.bottom >= box.t && nb.top <= box.b && !selected.has(g.id)) {
          selected.add(g.id);
          added++;
        }
      }
      if (added) changed();
      return;
    }
    const note = e.target.closest?.('g.note');
    if (note && pages.contains(note)) {
      if (selected.has(note.id)) selected.delete(note.id);
      else selected.add(note.id);
      changed();
    }
  });
  // Touch: plain taps toggle (no box select, so scrolling still works).
  pages.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const note = e.target.closest?.('g.note');
    if (!note) return;
    if (selected.has(note.id)) selected.delete(note.id);
    else selected.add(note.id);
    changed();
  });

  return {
    render,
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
