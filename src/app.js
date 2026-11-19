import { parseMusicXml, bytesToXml } from './musicxml.js';
import { parseMapping, resolve, noteName } from './mapping.js';

const $ = (id) => document.getElementById(id);

const state = {
  score: null,     // parsed score
  scoreUrl: null,  // set when the score came from a URL (for share links)
  mapText: '',
  mapUrl: null,
  rules: null,
  mapWarnings: [],
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

async function loadScore(getBytes, label, url = null) {
  setStatus('score', `Loading ${label}…`);
  try {
    const xml = await bytesToXml(await getBytes());
    state.score = parseMusicXml(xml);
    state.scoreUrl = url;
    const n = countNotes(state.score);
    setStatus('score', `✓ ${state.score.title}: ${state.score.parts.length} part${state.score.parts.length === 1 ? '' : 's'}, ${n} notes`, 'ok');
    render();
  } catch (e) {
    setStatus('score', e.message, 'error');
  }
}

async function loadMap(getText, label, url = null) {
  setStatus('map', `Loading ${label}…`);
  try {
    setMapText(await getText());
    state.mapUrl = url;
  } catch (e) {
    setStatus('map', e.message, 'error');
  }
}

function setMapText(text, fromEditor = false) {
  state.mapText = text;
  if (!fromEditor) $('map-text').value = text;
  try {
    const { rules, warnings } = parseMapping(text);
    state.rules = rules;
    state.mapWarnings = warnings;
    setStatus('map', `✓ ${rules.size} rule${rules.size === 1 ? '' : 's'}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`, warnings.length ? 'warn' : 'ok');
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
  return {
    names: $('opt-names').checked,
    rests: $('opt-rests').checked,
    mergeTies: $('opt-ties').checked,
    layout: $('opt-layout').value,
  };
}

/** Yields resolved events: { notes: [{ note, text, key, name }], rest }. */
function* resolvedEvents(voice, o) {
  for (const chord of voice.events) {
    let notes = chord;
    if (o.mergeTies) notes = notes.filter((n) => !n.tieStop);
    if (!notes.length) continue;
    const rest = notes.every((n) => n.rest);
    if (rest && !o.rests) continue;
    yield {
      rest,
      grace: notes.every((n) => n.grace),
      notes: notes.map((note) => {
        const r = resolve(state.rules, note);
        return { note, name: noteName(note), text: r.text, key: r.key };
      }),
    };
  }
}

function eventEl(ev, o) {
  const wrap = document.createElement('span');
  wrap.className = 'ev' + (ev.notes.length > 1 ? ' chord' : '') + (ev.rest ? ' rest' : '') + (ev.grace ? ' grace' : '');
  for (const r of ev.notes) {
    const tok = document.createElement('span');
    tok.className = 'tok' + (r.key == null ? ' unmapped' : '');
    const shown = r.text ?? r.name;
    tok.textContent = shown;
    if (r.key != null && !r.note.rest) tok.style.setProperty('--h', hueFor(shown));
    tok.title = `${r.name}${r.note.type ? ` (${r.note.type}${'.'.repeat(r.note.dots)})` : ''} → ${r.key == null ? 'no rule' : `rule "${r.key}"`}`;
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

  const usage = new Map(); // rule key → { text, count }
  let unmapped = 0;
  const root = $('render');
  root.replaceChildren();
  root.className = `layout-${o.layout}`;

  for (const part of score.parts) {
    const sec = document.createElement('section');
    sec.className = 'part';
    if (score.parts.length > 1) {
      const h = document.createElement('h3');
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
        for (const ev of resolvedEvents(v, o)) {
          for (const r of ev.notes) {
            if (r.key == null) { if (!r.note.rest) unmapped++; continue; }
            const u = usage.get(r.key) ?? { text: r.text, count: 0 };
            u.count++;
            usage.set(r.key, u);
          }
          vEl.append(eventEl(ev, o));
        }
        if (vEl.childElementCount) mEl.append(vEl);
      }
      body.append(mEl);
    }
    sec.append(body);
    root.append(sec);
  }

  // Legend: rules in the order they appear in the mapping file, with how often each was used.
  const legend = $('legend');
  legend.replaceChildren();
  for (const [key, text] of state.rules) {
    const k = key === 'REST' ? 'rest' : key;
    const u = usage.get(k);
    const item = document.createElement('span');
    item.className = 'leg' + (u ? '' : ' unused');
    if (k !== 'rest') item.style.setProperty('--h', hueFor(text));
    item.innerHTML = '<b></b> <span></span> <i></i>';
    item.children[0].textContent = k;
    item.children[1].textContent = text;
    item.children[2].textContent = u ? `×${u.count}` : 'unused';
    legend.append(item);
  }

  const warns = [...state.mapWarnings];
  if (unmapped) warns.push(`${unmapped} note${unmapped === 1 ? ' has' : 's have'} no matching rule and ${unmapped === 1 ? 'is' : 'are'} shown by name (highlighted). Add a "*" rule to catch them.`);
  const wEl = $('warnings');
  wEl.hidden = !warns.length;
  wEl.replaceChildren(...warns.map((w) => Object.assign(document.createElement('p'), { textContent: w })));
}

function asPlainText() {
  const o = opts();
  const out = [state.score.title, ''];
  for (const part of state.score.parts) {
    if (state.score.parts.length > 1) out.push(`## ${part.name}`);
    const measures = part.measures.map((m) => ({
      number: m.number,
      text: m.voices.map((v) => [...resolvedEvents(v, o)]
        .map((ev) => ev.notes.map((r) => r.text ?? r.name).join('+')).join(' ')).filter(Boolean).join(' / '),
    }));
    if (o.layout === 'flow') out.push(measures.map((m) => m.text).filter(Boolean).join(' '));
    else for (const m of measures) out.push(`${m.number}: ${m.text}`);
    out.push('');
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
$('map-text').addEventListener('input', (e) => {
  state.mapUrl = null; // edited, so the URL no longer describes it
  setMapText(e.target.value, true);
});
for (const id of ['opt-names', 'opt-rests', 'opt-ties', 'opt-layout']) $(id).addEventListener('change', render);
$('copy-text').addEventListener('click', (e) => copy(asPlainText(), e.currentTarget));
$('share-link').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!state.scoreUrl || !state.mapUrl) {
    btn.textContent = 'Load both from URLs first';
    setTimeout(() => { btn.textContent = 'Copy share link'; }, 2000);
    return;
  }
  const u = new URL(location.href);
  u.search = new URLSearchParams({ score: state.scoreUrl, map: state.mapUrl }).toString();
  u.hash = '';
  copy(u.toString(), btn);
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

// ?score=<url>&map=<url> preloads both.
const params = new URLSearchParams(location.search);
if (params.get('score')) {
  const s = params.get('score');
  $('score-url').value = s;
  loadScore(() => fetchBytes(s), s, s);
}
if (params.get('map')) {
  const m = params.get('map');
  $('map-url').value = m;
  loadMap(async () => new TextDecoder().decode(await fetchBytes(m)), m, m);
}
