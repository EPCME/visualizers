// Rhythm mappings: keys are note durations rather than pitches.
//
//   quarter          any quarter note (also: crotchet, 1/4, q)
//   dotted quarter   only dotted quarters (also: quarter., 1/4.); "double dotted" works too
//   quarter rest     a quarter rest; "rest" alone covers every rest
//   *                anything not matched by another rule
//
// Lookup goes from most to least specific: the exact duration with its dots, then the same duration
// without dots, then (for rests) "rest", then "*".

/** Note types from longest to shortest, with their length in quarter notes. Names match MusicXML <type>. */
export const TYPES = [
  ['breve', 8], ['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 1 / 2],
  ['16th', 1 / 4], ['32nd', 1 / 8], ['64th', 1 / 16], ['128th', 1 / 32],
];
const QL = new Map(TYPES);

const ALIASES = {
  'double whole': 'breve', 'double-whole': 'breve', '2/1': 'breve',
  semibreve: 'whole', '1/1': 'whole', w: 'whole',
  minim: 'half', '1/2': 'half', h: 'half',
  crotchet: 'quarter', '1/4': 'quarter', q: 'quarter',
  quaver: 'eighth', '8th': 'eighth', '1/8': 'eighth', e: 'eighth',
  semiquaver: '16th', sixteenth: '16th', '1/16': '16th', s: '16th',
  demisemiquaver: '32nd', 'thirty-second': '32nd', '1/32': '32nd',
  hemidemisemiquaver: '64th', 'sixty-fourth': '64th', '1/64': '64th',
  '1/128': '128th',
};
const typeOf = (word) => (QL.has(word) ? word : ALIASES[word] ?? null);

/** The readable, canonical name of a duration: "dotted quarter", "eighth rest", "double dotted half". */
export function durationLabel(type, dots = 0, rest = false) {
  const dot = ['', 'dotted ', 'double dotted ', 'triple dotted '][dots] ?? `${dots}× dotted `;
  return `${dot}${type}${rest ? ' rest' : ''}`;
}

/** Normalise a rhythm key to its canonical label ("dotted quarter", "rest", "*"), or null if invalid. */
export function normaliseRhythmKey(raw) {
  let key = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  key = key.replace(/double[ -]whole/, 'breve');
  if (/^(rest|r)$/.test(key)) return 'rest';
  if (/^(\*|default|other)$/.test(key)) return '*';
  const m = /^(?:(double[ -]?dotted|dotted) )?([a-z0-9/-]+?)(\.{0,3})(?: (rest))?$/.exec(key);
  if (!m) return null;
  const type = typeOf(m[2]);
  if (!type) return null;
  const dots = m[3].length + (m[1] ? (m[1].startsWith('double') ? 2 : 1) : 0);
  return durationLabel(type, dots, !!m[4]);
}

/** A length in quarter notes as a type plus dots, or null when no single note has that length. */
export function fromQuarters(ql) {
  for (const [type, base] of TYPES) {
    for (let dots = 0; dots <= 3; dots++) {
      if (Math.abs(base * (2 - 2 ** -dots) - ql) < 1e-6) return { type, dots };
    }
  }
  return null;
}

/**
 * The duration to show for a note: its written type and dots, or, when ties are merged and the note starts
 * a tied chain, the chain's total length. Notes with no <type> (whole-measure rests, mostly) use their length.
 * Returns { type, dots } or { label } when the length can't be written as one note.
 */
export function durationOf(note, mergeTies) {
  if (mergeTies && note.tied?.length > 1) {
    const total = note.tied.reduce((sum, n) => sum + n.ql, 0);
    return fromQuarters(total) ?? { label: note.tied.map((n) => labelOf(durationOf(n, false))).join(' + ') };
  }
  if (note.type && QL.has(note.type)) return { type: note.type, dots: note.dots };
  return fromQuarters(note.ql) ?? { label: note.type || `${+note.ql.toFixed(3)} beats` };
}

const labelOf = (d, rest = false) => d.label ?? durationLabel(d.type, d.dots, rest);

/**
 * Resolve one event (a single note, a chord, or a rest) to a duration rule.
 * Returns { value: {text,image}|null, key, name } where key is the matching rule's key, or null.
 */
export function resolveRhythm(allRules, note, mergeTies) {
  const rules = new Map([...allRules].filter(([, v]) => v.text || v.image));
  const d = durationOf(note, mergeTies);
  const rest = !!note.rest;
  const name = labelOf(d, rest);
  const candidates = d.label ? [] : [durationLabel(d.type, d.dots, rest), durationLabel(d.type, 0, rest)];
  if (rest) candidates.push('rest');
  candidates.push('*');
  for (const key of candidates) {
    if (rules.has(key)) return { value: rules.get(key), key, name };
  }
  return { value: null, key: null, name };
}

/** Suggestions for the rule editor's key box. */
export const RHYTHM_SUGGESTIONS = [
  'whole', 'dotted half', 'half', 'dotted quarter', 'quarter', 'dotted eighth', 'eighth', '16th', '32nd',
  'whole rest', 'half rest', 'quarter rest', 'eighth rest', '16th rest', 'rest', '*',
];
