// Parse a user-supplied mapping file and resolve notes to strings.
//
// Accepted formats:
//   JSON:  { "G": "cheese", "F#4": "lime", "rest": "..." }
//   Text:  one rule per line, `KEY = value` or `KEY: value`; `#` or `//` start a comment.
//
// Keys are case-insensitive for the letter, and may be:
//   C           any C, in any octave (with no sharp or flat)
//   C#  Db      a pitch with an accidental (# / b, also ## / bb, or ♯ ♭)
//   C4  C#4     a pitch in a specific octave
//   rest        rests
//   *  default  anything not matched by another rule
//
// Lookup goes from most to least specific: spelled note plus octave, then spelled note,
// then the enharmonic equivalent (sharp/flat respelling) plus octave and without, then
// "*". A note that matches nothing is shown by its own name.

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Normalise a mapping key to a canonical form ("C#4", "Bb", "REST", "*"), or null if invalid. */
export function normaliseKey(raw) {
  const key = String(raw).trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/𝄪/g, '##').replace(/𝄫/g, 'bb');
  if (/^(rest|r)$/i.test(key)) return 'REST';
  if (/^(\*|default|other)$/i.test(key)) return '*';
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)?$/.exec(key);
  if (!m) return null;
  const acc = m[2] === 'x' ? '##' : (m[2] || '');
  return m[1].toUpperCase() + acc + (m[3] ?? '');
}

/**
 * Parse a replacement value. Pictures are written markdown-style, `![label](url)`, or as `img:url`.
 * Returns { text, image } where image is a URL (http(s), relative, or data:) or null.
 */
export function parseValue(raw) {
  if (raw && typeof raw === 'object') {
    return { text: String(raw.text ?? raw.alt ?? raw.label ?? ''), image: raw.image ?? raw.img ?? raw.src ?? null };
  }
  const v = String(raw).trim();
  const md = /^!\[([^\]]*)\]\(\s*(\S+?)\s*\)$/.exec(v);
  if (md) return { text: md[1], image: md[2] };
  const pre = /^(?:img|image|picture):\s*(\S+)$/i.exec(v);
  if (pre) return { text: '', image: pre[1] };
  return { text: v.replace(/^(["'])(.*)\1$/, '$2'), image: null };
}

/** Serialise one value back to the text format. */
export function formatValue({ text, image }) {
  if (image) return `![${(text || '').replace(/[\]\n]/g, ' ')}](${image})`;
  return /^\s|\s$|^["']|^!\[|^(img|image|picture):|\s\/\//i.test(text) ? `"${text}"` : text;
}

/** Parse mapping file text. Returns { rules: Map<key,{text,image}>, entries, warnings }. */
export function parseMapping(text) {
  const rules = new Map();
  const warnings = [];
  const trimmed = text.trim();
  let entries = [];

  if (trimmed.startsWith('{')) {
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Mapping looks like JSON but couldn't be parsed: ${e.message}`);
    }
    entries = Object.entries(obj).map(([k, v], i) => [k, v, `entry ${i + 1}`]);
  } else {
    text.split(/\r?\n/).forEach((line, i) => {
      // Whole-line comments start with '#' or '//'; inline comments use ' //' ('#' would clash with sharps).
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('//')) return;
      const clean = t.replace(/\s\/\/.*$/, '').trim();
      const m = /^(.+?)\s*(?:=|:|\t|->|→)\s*(.*)$/.exec(clean);
      if (!m) {
        warnings.push(`Line ${i + 1}: expected "NOTE = text", got "${line.trim()}"`);
        return;
      }
      entries.push([m[1], m[2], `line ${i + 1}`]);
    });
  }

  const parsed = [];
  for (const [k, raw, where] of entries) {
    const v = parseValue(raw);
    const key = normaliseKey(k);
    parsed.push({ rawKey: String(k).trim(), key, value: v });
    if (!key) {
      warnings.push(`${where}: "${k}" isn't a note name (try G, F#, Bb4, rest or *)`);
      continue;
    }
    if (rules.has(key)) warnings.push(`${where}: "${k}" is defined more than once; the last one wins`);
    rules.set(key, v);
  }
  if (rules.size === 0) warnings.push('The mapping has no usable rules.');
  return { rules, entries: parsed, warnings };
}

function accidental(alter) {
  if (!alter) return '';
  return alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
}

/** The spelled name of a parsed note, e.g. "F#4", or "rest". */
export function noteName(note) {
  if (note.rest) return 'rest';
  return note.step + accidental(note.alter) + (note.octave ?? '');
}

/**
 * Resolve a note to its mapped value.
 * Returns { value: {text,image}|null, key } where key is the rule that matched, or null for no match.
 */
export function resolve(allRules, note) {
  // Rules with no text and no picture (e.g. a half-filled editor row) don't match anything yet.
  const rules = new Map([...allRules].filter(([, v]) => v.text || v.image));
  if (note.rest) {
    if (rules.has('REST')) return { value: rules.get('REST'), key: 'rest' };
    if (rules.has('*')) return { value: rules.get('*'), key: '*' };
    return { value: null, key: null };
  }
  const alter = Math.round(note.alter || 0);
  const spelled = note.step + accidental(alter);
  const candidates = [];
  if (note.octave != null) candidates.push(spelled + note.octave);
  candidates.push(spelled);

  // Enharmonic respellings by pitch class (C#/Db, E#/F, Cb/B, ...). Octave follows the sounding pitch.
  const semis = STEP_SEMITONES[note.step] + alter + 12 * (note.octave ?? 4);
  const pc = ((semis % 12) + 12) % 12;
  const oct = Math.floor(semis / 12);
  for (const name of new Set([SHARP_NAMES[pc], FLAT_NAMES[pc]])) {
    if (name === spelled) continue;
    if (note.octave != null) candidates.push(name + oct);
    candidates.push(name);
  }

  for (const key of candidates) {
    if (rules.has(key)) return { value: rules.get(key), key };
  }
  if (rules.has('*')) return { value: rules.get('*'), key: '*' };
  return { value: null, key: null };
}
