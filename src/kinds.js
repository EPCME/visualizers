// The renderings. Each one maps the same selected notes through its own mapping, keyed differently:
// the melodic one by pitch, the rhythmic one by duration. To add a rendering, add a kind here.
//
// A kind supplies:
//   id, title, tab        names (title heads the rendering; tab labels its mapping)
//   storeKey              localStorage key for its mapping
//   shareUrl, shareText   share-link params for a mapping URL / a packed mapping
//   normalise, invalid    key parsing for its mapping file (see parseMapping)
//   keyLabel(key)         how a canonical key is shown in the legend
//   editor                rule-editor settings: key placeholder, tooltip, suggestions, starter set
//   presets               [{ url, label }]
//   tokens(notes, rules, o)  what one event shows: [{ note, name, detail, text, image, key }]
//   sig(tokens)           identity for coalescing repeats, or null to never coalesce

import { resolve, noteName, normaliseKey } from './mapping.js';
import { resolveRhythm, normaliseRhythmKey, RHYTHM_SUGGESTIONS } from './rhythm.js';

const dotted = (note) => (note.type ? ` (${note.type}${'.'.repeat(note.dots)})` : '');

export const MELODIC = {
  id: 'melodic',
  title: 'Extracted Melodic Pattern',
  tab: 'Melodic',
  storeKey: 'visualizers.mapping',
  shareUrl: 'map',
  shareText: 'm',
  normalise: normaliseKey,
  invalid: (k) => `"${k}" isn't a note name (try G, F#, Bb4, rest or *)`,
  keyLabel: (k) => (k === 'REST' ? 'rest' : k),
  editor: {
    placeholder: 'G',
    title: 'Note: G, F#, Bb, C4, rest, or * for everything else',
    starter: { label: '+ C–B starter set', title: 'Adds a rule for each of C D E F G A B', keys: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
  },
  hint: 'Map each pitch to a word or picture.',
  presets: [
    { url: 'examples/foods.txt', label: 'Foods (C = cheese, D = dumpling…)' },
    { url: 'examples/animals.txt', label: 'Animal pictures' },
    { url: 'examples/solfege-d-major.txt', label: 'Solfège, D major (D = Do)' },
  ],
  tokens(notes, rules) {
    return notes.map((note) => {
      const r = resolve(rules, note);
      const name = noteName(note);
      return { note, name, detail: name + dotted(note), text: r.value?.text ?? null, image: r.value?.image ?? null, key: r.key };
    });
  },
  sig: (tokens) => (tokens[0].note.rest ? null : tokens.map((t) => t.note.midi).sort((a, b) => a - b).join(',')),
};

export const RHYTHMIC = {
  id: 'rhythmic',
  title: 'Extracted Rhythmic Pattern',
  tab: 'Rhythmic',
  storeKey: 'visualizers.mapping.rhythm',
  shareUrl: 'rmap',
  shareText: 'rm',
  normalise: normaliseRhythmKey,
  invalid: (k) => `"${k}" isn't a duration (try quarter, dotted half, eighth rest, rest or *)`,
  keyLabel: (k) => k,
  editor: {
    placeholder: 'quarter',
    title: 'Duration: whole, half, quarter, eighth, 16th…, optionally "dotted", or a rest like "quarter rest"; "rest" for every rest; * for everything else',
    suggestions: RHYTHM_SUGGESTIONS,
    wide: true,
    starter: { label: '+ Common durations', title: 'Adds a rule for each of whole, half, quarter, eighth, 16th and rest', keys: ['whole', 'half', 'quarter', 'eighth', '16th', 'rest'] },
  },
  hint: 'Map each duration (quarter, dotted half, eighth rest…) to a word or picture.',
  presets: [
    { url: 'examples/rhythm-kodaly.txt', label: 'Kodály syllables (quarter = ta, eighth = ti…)' },
    { url: 'examples/rhythm-beats.txt', label: 'Beats (quarter = 1, half = 2…)' },
  ],
  // A chord is one rhythmic event, so it gets one token. Its notes share a duration; the first one speaks for it.
  tokens(notes, rules, o) {
    const note = notes[0];
    const r = resolveRhythm(rules, note, o.mergeTies);
    const pitches = notes.filter((n) => !n.rest).map(noteName).join(' ');
    return [{ note, name: r.name, detail: r.name + (pitches ? ` (${pitches})` : ''), text: r.value?.text ?? null, image: r.value?.image ?? null, key: r.key }];
  },
  sig: (tokens) => (tokens[0].note.rest ? null : tokens[0].name),
};

export const KINDS = [MELODIC, RHYTHMIC];
