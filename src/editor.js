// On-page rule editor. Rows are the editing model; they serialise to the mapping text format,
// which stays the single source of truth that the renderer parses.

import { normaliseKey, formatValue } from './mapping.js';

const MAX_SIDE = 240; // uploaded pictures are shrunk to fit this box

/** Shrink an uploaded image to a small data: URL so mappings stay portable and light. */
export async function imageFileToDataUrl(file) {
  const asDataUrl = () => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(file);
  });
  // Keep vector and animated images as they are.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return asDataUrl();
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return asDataUrl();
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

export const STARTER_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function rowsToText(rows) {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key.trim()} = ${formatValue(r.kind === 'image' && r.image ? { text: r.text, image: r.image } : { text: r.text, image: null })}`)
    .join('\n') + '\n';
}

export function rowsFromEntries(entries) {
  return entries.map((e) => ({
    key: e.rawKey,
    kind: e.value.image ? 'image' : 'text',
    text: e.value.text,
    image: e.value.image,
  }));
}

/**
 * Mount the editor in `container`. `onChange(rows)` fires after every edit.
 * Returns { setRows(rows), getRows(), addRow(row), focusLast() }.
 */
export function mountEditor(container, onChange) {
  let rows = [];

  const el = (tag, props = {}, ...children) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter(Boolean));
    return n;
  };

  function rowEl(row, i) {
    const keyValid = !row.key.trim() || normaliseKey(row.key) != null;
    const key = el('input', {
      className: 'r-key' + (keyValid ? '' : ' invalid'), value: row.key, placeholder: 'G',
      title: 'Note: G, F#, Bb, C4, rest, or * for everything else', autocomplete: 'off', spellcheck: false,
    });
    key.setAttribute('aria-label', `Rule ${i + 1} note`);
    key.dataset.field = 'key';

    const seg = el('div', { className: 'seg', role: 'group' });
    seg.setAttribute('aria-label', 'Replacement type');
    for (const [kind, label] of [['text', 'Text'], ['image', 'Picture']]) {
      const b = el('button', { type: 'button', textContent: label });
      b.dataset.kind = kind;
      b.setAttribute('aria-pressed', String(row.kind === kind));
      seg.append(b);
    }

    let value;
    if (row.kind === 'text') {
      value = el('input', { className: 'r-text', value: row.text, placeholder: 'text to show, e.g. cheese', autocomplete: 'off' });
      value.setAttribute('aria-label', `Rule ${i + 1} text`);
      value.dataset.field = 'text';
    } else {
      const thumb = row.image
        ? el('img', { className: 'r-thumb', src: row.image, alt: row.text || 'picture' })
        : el('span', { className: 'r-thumb empty', textContent: '?' });
      if (row.image) thumb.addEventListener('error', () => thumb.classList.add('broken'), { once: true });
      const file = el('input', { type: 'file', accept: 'image/*', className: 'r-file' });
      file.setAttribute('aria-label', `Rule ${i + 1} picture file`);
      const isData = row.image?.startsWith('data:');
      const url = el('input', {
        type: 'url', className: 'r-url', value: isData ? '' : (row.image ?? ''),
        placeholder: isData ? 'Uploaded ✓ (or paste a URL)' : 'Picture URL', autocomplete: 'off',
      });
      url.setAttribute('aria-label', `Rule ${i + 1} picture URL`);
      url.dataset.field = 'image';
      const label = el('input', { className: 'r-label', value: row.text, placeholder: 'label (optional)', autocomplete: 'off' });
      label.setAttribute('aria-label', `Rule ${i + 1} picture label`);
      label.dataset.field = 'text';
      value = el('div', { className: 'r-image' },
        thumb,
        el('label', { className: 'upload' }, 'Upload', file),
        url,
        label);
    }

    const del = el('button', { type: 'button', className: 'r-del', textContent: '×', title: 'Remove rule' });
    del.setAttribute('aria-label', `Remove rule ${i + 1}`);

    const r = el('div', { className: 'rule' }, key, el('span', { className: 'arrow', textContent: '→' }), seg, value, del);
    r.dataset.i = i;
    return r;
  }

  function draw() {
    container.replaceChildren(...rows.map(rowEl));
    if (!rows.length) container.append(el('p', { className: 'empty-rules', textContent: 'No rules yet. Add one, use the starter set, or load a file.' }));
  }

  const idx = (target) => Number(target.closest('.rule')?.dataset.i);

  container.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (!f) return;
    const row = rows[idx(e.target)];
    row[f] = e.target.value;
    if (f === 'key') e.target.classList.toggle('invalid', !!row.key.trim() && normaliseKey(row.key) == null);
    if (f === 'image') {
      const old = e.target.closest('.rule').querySelector('.r-thumb');
      const img = el('img', { className: 'r-thumb', src: row.image, alt: '' });
      img.addEventListener('error', () => img.classList.add('broken'), { once: true });
      if (row.image) old.replaceWith(img);
    }
    onChange(rows);
  });

  container.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('r-file')) return;
    const file = e.target.files[0];
    if (!file) return;
    const i = idx(e.target);
    try {
      rows[i].image = await imageFileToDataUrl(file);
      if (!rows[i].text) rows[i].text = file.name.replace(/\.[^.]+$/, '');
    } catch {
      return;
    }
    draw();
    onChange(rows);
  });

  container.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = idx(b);
    if (b.dataset.kind) {
      if (rows[i].kind === b.dataset.kind) return;
      rows[i].kind = b.dataset.kind;
      draw();
      container.querySelector(`.rule[data-i="${i}"] ${b.dataset.kind === 'text' ? '.r-text' : '.r-url'}`)?.focus();
      onChange(rows);
    } else if (b.classList.contains('r-del')) {
      rows.splice(i, 1);
      draw();
      onChange(rows);
    }
  });

  return {
    setRows(next) { rows = next; draw(); },
    getRows: () => rows,
    addRows(newRows) {
      rows.push(...newRows);
      draw();
      onChange(rows);
    },
    focusRow(i) { container.querySelector(`.rule[data-i="${i}"] .r-key`)?.focus(); },
  };
}
