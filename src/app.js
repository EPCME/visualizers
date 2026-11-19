import { parseMusicXml, bytesToXml } from './musicxml.js';
import { parseMapping } from './mapping.js';
import { buildView, parseThresholds, rangesFrom } from './view.js';
import { mountEngraver } from './engrave.js';
import { packText, unpackText } from './share.js';
import { mountEditor, rowsToText, rowsFromEntries, STARTER_KEYS } from './editor.js';

const $ = (id) => document.getElementById(id);

const state = {
  score: null,     // parsed score
  scoreUrl: null,  // set when the score came from a URL (for share links)
  mapText: '',
  mapUrl: null,
  rules: null,
  mapWarnings: [],
  selected: new Set(), // note ids picked on the engraved score; empty = map every note
};

// ---------- loading ----------

async function fetchBytes(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Couldn\'t fetch that URL. The server probably blocks cross-origin requests (CORS); download the file and choose it instead.');
  }
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`);
  return res.arrayBuffer();
}

function setStatus(which, msg, kind = '') {
  const el = $(`${which}-status`);
  el.textContent = msg;
  el.className = `status ${kind}`;
}

async function loadScore(getBytes, label, url = null, { selection = [] } = {}) {
  setStatus('score', `Loading ${label}…`);
  try {
    const xml = await bytesToXml(await getBytes());
    state.score = parseMusicXml(xml);
    state.scoreUrl = url;
    setSelection(new Set(selection));
    $('engraved').hidden = false;
    engraver.render(state.score.xml);
    const n = countNotes(state.score);
    setStatus('score', `✓ ${state.score.title}: ${state.score.parts.length} part${state.score.parts.length === 1 ? '' : 's'}, ${n} notes`, 'ok');
    render();
  } catch (e) {
    setStatus('score', e.message, 'error');
  }
}

async function loadMap(getText, label, url = null, opts = {}) {
  setStatus('map', `Loading ${label}…`);
  try {
    setMapText(await getText(), 'external', opts);
    state.mapUrl = url;
  } catch (e) {
    setStatus('map', e.message, 'error');
  }
}

const STORE_KEY = 'visualizers.mapping';
function remember(text) {
  try { localStorage.setItem(STORE_KEY, text); } catch { /* storage unavailable or full: fine */ }
}
function recall() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

/**
 * The mapping text is the source of truth. `source` says who changed it, so the other views update:
 * 'editor' (rule rows), 'textarea' (Edit as text), or 'external' (file, URL, storage, example).
 * `persist: false` (used for share links) keeps the visitor's own saved mapping until they edit.
 */
function setMapText(text, source = 'external', { persist = true } = {}) {
  state.mapText = text;
  if (source !== 'textarea') $('map-text').value = text;
  if (source !== 'editor') state.mapUrl = null;
  if (persist) remember(text);
  try {
    const { rules, entries, warnings } = parseMapping(text);
    if (source !== 'editor') editor.setRows(rowsFromEntries(entries));
    const empty = rules.size === 0 && !text.trim();
    state.rules = rules;
    state.mapWarnings = empty ? [] : warnings;
    if (empty) setStatus('map', 'No rules yet.');
    else setStatus('map', `✓ ${rules.size} rule${rules.size === 1 ? '' : 's'}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`, warnings.length ? 'warn' : 'ok');
  } catch (e) {
    state.rules = null;
    state.mapWarnings = [];
    setStatus('map', e.message, 'error');
  }
  render();
}

function countNotes(score) {
  let n = 0;
  for (const p of score.parts) for (const m of p.measures) for (const v of m.voices) for (const ev of v.events) n += ev.filter((x) => !x.rest).length;
  return n;
}

// ---------- rendering ----------

/** Stable hue per mapped string, so the same word is always the same colour. */
function hueFor(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return ((h >>> 0) % 360);
}

function opts() {
  const { points, bad } = parseThresholds($('opt-split').value);
  return {
    names: $('opt-names').checked,
    rests: $('opt-rests').checked,
    mergeTies: $('opt-ties').checked,
    coalesce: $('opt-coalesce').checked,
    layout: $('opt-layout').value,
    selected: state.selected,
    ranges: rangesFrom(points),
    badThresholds: bad,
  };
}

function eventEl(ev, o) {
  const wrap = document.createElement('span');
  wrap.className = 'ev' + (ev.notes.length > 1 ? ' chord' : '') + (ev.rest ? ' rest' : '') + (ev.grace ? ' grace' : '');
  wrap.dataset.ids = ev.ids.join(' ');
  for (const r of ev.notes) {
    const tok = document.createElement('span');
    tok.className = 'tok' + (r.key == null && !r.note.rest ? ' unmapped' : '');
    const shown = r.text ?? r.name;
    if (r.image) {
      tok.classList.add('pic');
      const img = document.createElement('img');
      img.src = r.image;
      img.alt = r.text || r.name;
      img.loading = 'lazy';
      tok.append(img);
    } else {
      tok.textContent = shown;
      if (r.key != null && !r.note.rest) tok.style.setProperty('--h', hueFor(shown));
    }
    const why = r.key == null ? 'no rule' : `rule "${r.key}"`;
    tok.title = `${r.text ? `${r.text}: ` : ''}${r.name}${r.note.type ? ` (${r.note.type}${'.'.repeat(r.note.dots)})` : ''} → ${why}`;
    if (o.names) {
      const small = document.createElement('small');
      small.textContent = r.name;
      tok.append(small);
    }
    wrap.append(tok);
  }
  return wrap;
}

function render() {
  const out = $('output');
  if (!state.score || !state.rules) {
    out.hidden = true;
    return;
  }
  out.hidden = false;
  const o = opts();
  const { score } = state;
  $('score-title').textContent = score.title;
  $('score-sub').textContent = [score.composer, `${score.parts.length} part${score.parts.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  const sections = buildView(score, state.rules, o);
  const usage = new Map(); // rule key → count
  let unmapped = 0;
  const root = $('render');
  root.replaceChildren();
  root.className = `layout-${o.layout}`;
  const split = sections.length > 1;

  for (const { range, noteCount, parts } of sections) {
    const host = split ? document.createElement('section') : root;
    if (split) {
      host.className = 'range';
      const h = document.createElement('h3');
      h.className = 'range-h';
      h.textContent = `Notes ${range.label}`;
      const n = document.createElement('span');
      n.textContent = noteCount ? ` · ${noteCount} note${noteCount === 1 ? '' : 's'}` : ' · no notes';
      h.append(n);
      host.append(h);
      root.append(host);
      if (!noteCount) continue;
    }
    for (const part of parts) {
      const sec = document.createElement('section');
      sec.className = 'part';
      if (parts.length > 1) {
        const h = document.createElement('h4');
        h.textContent = part.name;
        sec.append(h);
      }
      const body = document.createElement('div');
      body.className = 'part-body';
      for (const m of part.measures) {
        const mEl = document.createElement('div');
        mEl.className = 'measure';
        const num = document.createElement('span');
        num.className = 'mnum';
        num.textContent = m.number;
        mEl.append(num);
        for (const v of m.voices) {
          const vEl = document.createElement('div');
          vEl.className = 'voice';
          if (m.voices.length > 1) vEl.dataset.voice = `v${v.voice}`;
          for (const ev of v.events) {
            for (const r of ev.notes) {
              if (r.key == null) { if (!r.note.rest) unmapped++; continue; }
              usage.set(r.key, (usage.get(r.key) ?? 0) + 1);
            }
            vEl.append(eventEl(ev, o));
          }
          if (vEl.childElementCount) mEl.append(vEl);
        }
        body.append(mEl);
      }
      sec.append(body);
      host.append(sec);
    }
  }

  // Legend: rules in the order they appear in the mapping file, with how often each was used.
  const legend = $('legend');
  legend.replaceChildren();
  for (const [key, { text, image }] of state.rules) {
    const k = key === 'REST' ? 'rest' : key;
    const u = usage.get(k);
    const item = document.createElement('span');
    item.className = 'leg' + (u ? '' : ' unused');
    if (k !== 'rest' && !image) item.style.setProperty('--h', hueFor(text));
    item.innerHTML = '<b></b> <span></span> <i></i>';
    item.children[0].textContent = k;
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = '';
      item.children[1].append(img, text ? ` ${text}` : '');
    } else {
      item.children[1].textContent = text;
    }
    item.children[2].textContent = u ? `×${u}` : 'unused';
    legend.append(item);
  }

  const warns = [...state.mapWarnings];
  if (o.badThresholds.length) warns.push(`Ignored pitch threshold${o.badThresholds.length === 1 ? '' : 's'} ${o.badThresholds.map((b) => `"${b}"`).join(', ')}: each needs a letter and an octave, like C4 or F#5.`);
  if (unmapped) warns.push(`${unmapped} note${unmapped === 1 ? ' has' : 's have'} no matching rule and ${unmapped === 1 ? 'is' : 'are'} shown by name (highlighted). Add a "*" rule to catch them.`);
  const wEl = $('warnings');
  wEl.hidden = !warns.length;
  wEl.replaceChildren(...warns.map((w) => Object.assign(document.createElement('p'), { textContent: w })));
  updateShareButton();
}

function asPlainText() {
  const o = opts();
  const out = [state.score.title, ''];
  const sections = buildView(state.score, state.rules, o);
  for (const { range, parts } of sections) {
    if (sections.length > 1) out.push(`# Notes ${range.label}`, '');
    for (const part of parts) {
      if (parts.length > 1) out.push(`## ${part.name}`);
      const measures = part.measures.map((m) => ({
        number: m.number,
        text: m.voices.map((v) => v.events
          .map((ev) => ev.notes.map((r) => r.text || (r.image ? `[${r.name}]` : r.text ?? r.name)).join('+'))
          .join(' ')).filter(Boolean).join(' / '),
      }));
      if (o.layout === 'flow') out.push(measures.map((m) => m.text).filter(Boolean).join(' '));
      else for (const m of measures) if (m.text) out.push(`${m.number}: ${m.text}`);
      out.push('');
    }
  }
  return out.join('\n');
}

async function copy(text, button) {
  const old = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied ✓';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = old; }, 1500);
}

// ---------- wiring ----------

$('score-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadScore(() => f.arrayBuffer(), f.name);
});
$('map-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadMap(() => f.text(), f.name);
});
$('score-url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('score-url').value.trim();
  if (url) loadScore(() => fetchBytes(url), url, url);
});
$('map-url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('map-url').value.trim();
  if (url) loadMap(async () => new TextDecoder().decode(await fetchBytes(url)), url, url);
});
$('map-text').addEventListener('input', (e) => setMapText(e.target.value, 'textarea'));
$('map-preset').addEventListener('change', async (e) => {
  const sel = e.target;
  if (!sel.value) return;
  const url = new URL(sel.value, location.href).href;
  const label = sel.selectedOptions[0].textContent;
  sel.value = ''; // back to "Choose…", so the same preset can be picked again after editing
  $('map-url').value = url;
  await loadMap(async () => new TextDecoder().decode(await fetchBytes(url)), `preset: ${label}`, url);
});

// ---------- rule editor ----------

const editor = mountEditor($('rules'), (rows) => {
  state.mapUrl = null; // edited, so the URL no longer describes it
  setMapText(rowsToText(rows), 'editor');
});
const blankRow = (key = '') => ({ key, kind: 'text', text: '', image: null });
$('add-rule').addEventListener('click', () => {
  editor.addRows([blankRow()]);
  editor.focusRow(editor.getRows().length - 1);
});
$('starter-rules').addEventListener('click', () => {
  const have = new Set(editor.getRows().map((r) => r.key.trim().toUpperCase()));
  const first = editor.getRows().length;
  editor.addRows(STARTER_KEYS.filter((k) => !have.has(k)).map((k) => blankRow(k)));
  editor.focusRow(first);
});
let clearedBackup = null;
let clearTimer;
$('clear-rules').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  clearTimeout(clearTimer);
  if (clearedBackup != null) { // second click within the window: undo
    setMapText(clearedBackup, 'external');
    clearedBackup = null;
    btn.textContent = 'Clear all';
    return;
  }
  if (!editor.getRows().length) return;
  clearedBackup = state.mapText;
  setMapText('', 'external');
  btn.textContent = 'Undo clear';
  clearTimer = setTimeout(() => { clearedBackup = null; btn.textContent = 'Clear all'; }, 8000);
});
$('download-map').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.mapText], { type: 'text/plain' }));
  a.download = 'mapping.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
for (const id of ['opt-names', 'opt-rests', 'opt-ties', 'opt-layout', 'opt-coalesce']) $(id).addEventListener('change', render);
$('opt-split').addEventListener('input', render);

// ---------- engraved score + selection ----------

function setSelection(ids, fromEngraver = false) {
  state.selected = ids;
  if (!fromEngraver) engraver.setSelection(ids);
  const n = ids.size;
  $('sel-count').textContent = n
    ? `${n} note${n === 1 ? '' : 's'} selected: only ${n === 1 ? 'it is' : 'these are'} shown below.`
    : 'No notes selected, so every note is mapped.';
  $('sel-clear').hidden = !n;
  render();
}
const engraver = mountEngraver($('engraving'), {
  onSelect: (ids) => setSelection(ids, true),
  onStatus: (msg, kind) => setStatus('engrave', msg, kind),
});
$('sel-clear').addEventListener('click', () => setSelection(new Set()));
$('box-mode').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? 'Box select: on (drag to select)' : 'Box select';
  engraver.setBoxMode(on);
});
// Hovering a mapped note lights up its source note(s) in the engraving.
$('render').addEventListener('pointerover', (e) => {
  const ev = e.target.closest('.ev');
  engraver.highlight(ev ? ev.dataset.ids.split(' ') : null);
});
$('render').addEventListener('pointerleave', () => engraver.highlight(null));
$('copy-text').addEventListener('click', (e) => copy(asPlainText(), e.currentTarget));
/** Can the current score + mapping be put in a link? Returns null if yes, else the reason why not. */
function shareBlocker() {
  if (!state.scoreUrl) return 'To share, load the score from a URL (a file you chose can\'t go in a link).';
  if (state.mapUrl) return null;
  const uploaded = [...(state.rules?.entries() ?? [])].filter(([, v]) => v.image?.startsWith('data:')).map(([k]) => (k === 'REST' ? 'rest' : k));
  if (uploaded.length) {
    return `To share, swap the uploaded picture${uploaded.length === 1 ? '' : 's'} (${uploaded.join(', ')}) for picture URLs. Uploaded pictures can't go in a link.`;
  }
  return null;
}

function updateShareButton() {
  const reason = shareBlocker();
  const btn = $('share-link');
  btn.disabled = !!reason;
  btn.title = reason ?? 'Copy a link that opens this score with this mapping';
  $('share-hint').textContent = reason ?? '';
  $('share-hint').hidden = !reason;
}

async function shareUrl() {
  const u = new URL(location.pathname, location.origin);
  const p = new URLSearchParams({ score: state.scoreUrl });
  const split = $('opt-split').value.trim();
  if (split) p.set('split', split);
  if ($('opt-coalesce').checked) p.set('coalesce', '1');
  if (state.selected.size) p.set('sel', await packText([...state.selected].join(' ')));
  // An unedited mapping that came from a URL is linked by URL; anything else travels inside the link.
  if (state.mapUrl) p.set('map', state.mapUrl);
  else p.set('m', await packText(state.mapText));
  u.search = p.toString();
  return u.toString();
}

$('share-link').addEventListener('click', async (e) => {
  const btn = e.currentTarget; // currentTarget is cleared once the handler awaits
  if (shareBlocker()) return;
  copy(await shareUrl(), btn);
});

// Drag and drop onto either drop zone.
for (const zone of document.querySelectorAll('.drop')) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (zone.dataset.target === 'score') loadScore(() => f.arrayBuffer(), f.name);
    else loadMap(() => f.text(), f.name);
  });
}

$('load-example').addEventListener('click', () => {
  const s = new URL('examples/twinkle.musicxml', location.href).href;
  const m = new URL('examples/foods.txt', location.href).href;
  $('score-url').value = s;
  $('map-url').value = m;
  loadScore(() => fetchBytes(s), 'example score', s);
  loadMap(async () => new TextDecoder().decode(await fetchBytes(m)), 'example mapping', m);
});

// Share links: ?score=<url> plus either &map=<url> or &m=<packed mapping text>.
const params = new URLSearchParams(location.search);
if (params.get('split')) $('opt-split').value = params.get('split');
if (params.get('coalesce') === '1') $('opt-coalesce').checked = true;
if (params.get('score')) {
  const s = params.get('score');
  $('score-url').value = s;
  const selection = params.get('sel') ? (await unpackText(params.get('sel')).catch(() => '')).split(' ').filter(Boolean) : [];
  loadScore(() => fetchBytes(s), s, s, { selection });
}
if (params.get('m')) {
  loadMap(() => unpackText(params.get('m')), 'shared mapping', null, { persist: false });
} else if (params.get('map')) {
  const m = params.get('map');
  $('map-url').value = m;
  loadMap(async () => new TextDecoder().decode(await fetchBytes(m)), m, m, { persist: false });
} else {
  setMapText(recall() ?? '', 'external');
}
