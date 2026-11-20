// Load and parse MusicXML (.musicxml / .xml, and compressed .mxl) entirely in the browser.

/** Bytes → XML text. Handles compressed .mxl (zip) and plain XML in UTF-8 or UTF-16. */
export async function bytesToXml(bytes) {
  const u8 = new Uint8Array(bytes);
  if (u8[0] === 0x50 && u8[1] === 0x4b) return mxlToXml(u8); // "PK": zip archive
  if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) {
    return new TextDecoder(u8[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(u8);
  }
  return new TextDecoder('utf-8').decode(u8);
}

// ---- minimal zip reader (stored + deflate), enough for .mxl ----

async function mxlToXml(u8) {
  const files = readZipDirectory(u8);
  let path = null;
  const container = files.get('META-INF/container.xml');
  if (container) {
    const doc = new DOMParser().parseFromString(await bytesToXml(await extract(u8, container)), 'application/xml');
    path = doc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
  }
  if (!path || !files.has(path)) {
    path = [...files.keys()].find((n) => !n.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(n));
  }
  if (!path) throw new Error('This .mxl archive has no MusicXML file inside.');
  return bytesToXml(await extract(u8, files.get(path)));
}

function readZipDirectory(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .mxl (zip) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt .mxl central directory.');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function extract(u8, { method, compSize, localOffset }) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const start = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
  const data = u8.subarray(start, start + compSize);
  if (method === 0) return data;
  if (method !== 8) throw new Error(`Unsupported .mxl compression method ${method}.`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- MusicXML → plain data ----

const text = (el, sel) => el.querySelector(sel)?.textContent.trim() ?? null;
const kids = (el, name) => [...el.children].filter((c) => c.localName === name);

/**
 * Parse MusicXML text into:
 * { title, composer, xml, parts: [{ id, name, measures: [{ number, voices: [{ voice, events: [[note, ...chord], ...] }] }] }] }
 * Each note: { id, step, alter, octave, midi, rest, unpitched, duration, ql, type, dots, grace, tieStart, tieStop, tied?, staff, voice }
 * (ql is the length in quarter notes; `tied` is set on the first note of a tied chain, see linkTies)
 * Every <note> gets an `id` attribute (kept if already present) so the engraved score can be linked back;
 * `xml` is the score re-serialised with those ids.
 */
export function parseMusicXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('That file isn\'t valid XML: ' + err.textContent.split('\n')[0]);
  const root = doc.documentElement;
  if (root.localName !== 'score-partwise' && root.localName !== 'score-timewise') {
    throw new Error(`Expected a MusicXML score, found <${root.localName}>.`);
  }

  // Stamp ids before anything is cloned, so engraved notes (Verovio keeps these ids) map to parsed notes.
  let seq = 0;
  const seen = new Set();
  for (const n of root.getElementsByTagName('note')) {
    let id = n.getAttribute('id');
    if (!id || seen.has(id)) n.setAttribute('id', (id = `vz-n${++seq}`));
    seen.add(id);
  }

  const title = text(root, 'work > work-title') || text(root, 'movement-title') ||
    [...root.querySelectorAll('credit-words')].map((c) => c.textContent.trim()).find(Boolean) || 'Untitled score';
  const composer = text(root, 'identification > creator[type="composer"]');

  const partNames = new Map();
  for (const sp of root.querySelectorAll('part-list > score-part')) {
    partNames.set(sp.getAttribute('id'), text(sp, 'part-name') || sp.getAttribute('id'));
  }

  // Normalise to partwise: part id → list of <measure> elements.
  const partMeasures = new Map();
  if (root.localName === 'score-partwise') {
    for (const part of kids(root, 'part')) partMeasures.set(part.getAttribute('id'), kids(part, 'measure'));
  } else {
    for (const measure of kids(root, 'measure')) {
      for (const part of kids(measure, 'part')) {
        const id = part.getAttribute('id');
        if (!partMeasures.has(id)) partMeasures.set(id, []);
        const m = part.cloneNode(true);
        m.setAttribute('number', measure.getAttribute('number'));
        partMeasures.get(id).push(m);
      }
    }
  }

  const parts = [];
  for (const [id, measureEls] of partMeasures) {
    let divisions = 1; // <divisions> per quarter note; it carries over until an <attributes> changes it
    const measures = measureEls.map((mEl) => {
      const voices = new Map();
      for (const el of mEl.children) {
        if (el.localName === 'attributes') {
          divisions = Number(text(el, ':scope > divisions')) || divisions;
          continue;
        }
        if (el.localName !== 'note') continue;
        const note = parseNote(el);
        note.ql = note.duration / divisions;
        const vKey = (note.staff ? `${note.staff}:` : '') + note.voice;
        if (!voices.has(vKey)) voices.set(vKey, { voice: note.voice, staff: note.staff, events: [] });
        const events = voices.get(vKey).events;
        if (note.chord && events.length) events[events.length - 1].push(note);
        else events.push([note]);
      }
      return { number: mEl.getAttribute('number'), voices: [...voices.values()] };
    });
    linkTies(measures);
    parts.push({ id, name: partNames.get(id) ?? id, measures });
  }
  return { title, composer, parts, xml: new XMLSerializer().serializeToString(doc) };
}

/**
 * Follow ties through each voice (across barlines). The first note of a tied chain gets `tied`: every note in
 * the chain, itself included, so a view that merges ties can show the chain's total length.
 */
function linkTies(measures) {
  const open = new Map(); // voice key → Map(midi → chain head)
  for (const m of measures) {
    for (const v of m.voices) {
      const vKey = `${v.staff || '1'}:${v.voice}`;
      if (!open.has(vKey)) open.set(vKey, new Map());
      const pending = open.get(vKey);
      for (const chord of v.events) {
        for (const n of chord) {
          if (n.midi == null) continue;
          const head = n.tieStop ? pending.get(n.midi) : null;
          if (head) {
            head.tied.push(n);
            if (!n.tieStart) pending.delete(n.midi);
          } else if (n.tieStart) {
            n.tied = [n];
            pending.set(n.midi, n);
          }
        }
      }
    }
  }
}

function parseNote(el) {
  const pitch = el.querySelector(':scope > pitch');
  const unpitched = el.querySelector(':scope > unpitched');
  const n = {
    id: el.getAttribute('id'),
    rest: !!el.querySelector(':scope > rest'),
    unpitched: !!unpitched,
    chord: !!el.querySelector(':scope > chord'),
    grace: !!el.querySelector(':scope > grace'),
    step: null, alter: 0, octave: null,
    duration: Number(text(el, ':scope > duration')) || 0,
    type: text(el, ':scope > type'),
    dots: el.querySelectorAll(':scope > dot').length,
    tieStop: [...el.querySelectorAll(':scope > tie')].some((t) => t.getAttribute('type') === 'stop'),
    tieStart: [...el.querySelectorAll(':scope > tie')].some((t) => t.getAttribute('type') === 'start'),
    voice: text(el, ':scope > voice') || '1',
    staff: text(el, ':scope > staff'),
  };
  if (pitch) {
    n.step = text(pitch, 'step');
    n.alter = Number(text(pitch, 'alter')) || 0;
    n.octave = Number(text(pitch, 'octave'));
  } else if (unpitched) {
    n.step = text(unpitched, 'display-step');
    n.octave = Number(text(unpitched, 'display-octave'));
  } else if (!n.rest) {
    n.rest = true; // a note with no pitch info: treat as a rest
  }
  n.midi = n.rest || !n.step ? null : midiOf(n.step, n.alter, n.octave);
  return n;
}

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MIDI number (C4 = 60). Alter may be fractional for microtones; it's rounded. */
export function midiOf(step, alter = 0, octave = 4) {
  return 12 * (octave + 1) + STEP_SEMITONES[step.toUpperCase()] + Math.round(alter || 0);
}
