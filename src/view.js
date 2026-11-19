// Turns a parsed score + mapping + options into what the mapped view shows:
// selection filtering, pitch-range sections, tie merging, and coalescing of repeated notes.

import { resolve, noteName, normaliseKey } from './mapping.js';
import { midiOf } from './musicxml.js';

/** Parse "C4, G5" into sorted thresholds. Each needs an octave. Returns { points: [{ midi, label }], bad: [] }. */
export function parseThresholds(str) {
  const points = [];
  const bad = [];
  for (const raw of String(str).split(/[\s,;]+/).filter(Boolean)) {
    const key = normaliseKey(raw);
    const m = key && /^([A-G])(#{1,2}|b{1,2})?(-?\d+)$/.exec(key);
    if (!m) { bad.push(raw); continue; }
    const alter = !m[2] ? 0 : (m[2][0] === '#' ? m[2].length : -m[2].length);
    points.push({ midi: midiOf(m[1], alter, Number(m[3])), label: key });
  }
  points.sort((a, b) => a.midi - b.midi);
  return { points: points.filter((p, i) => i === 0 || p.midi !== points[i - 1].midi), bad };
}

/** The single section shown when nothing is split. */
export const WHOLE = { lo: -Infinity, hi: Infinity, voice: null, title: null };

/** Pitch-range sections from thresholds: [lo, hi), with titles. One unbounded section when there are no thresholds. */
export function rangesFrom(points) {
  if (!points.length) return [WHOLE];
  const at = (lo, hi, label) => ({ lo, hi, voice: null, title: `Notes ${label}` });
  const ranges = [at(-Infinity, points[0].midi, `below ${points[0].label}`)];
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1];
    ranges.push(at(points[i].midi, next ? next.midi : Infinity,
      next ? `${points[i].label} up to (not incl.) ${next.label}` : `${points[i].label} and above`));
  }
  return ranges;
}

const staffOf = (v) => v.staff || '1'; // single-staff parts usually omit <staff>
const voiceKey = (v) => `${staffOf(v)}:${v.voice}`;

/**
 * One section per distinct voice (staff + voice number) in the score, in staff then voice order.
 * Returns [] when no part has more than one voice, since there is nothing to split.
 */
export function voiceSections(score) {
  const all = new Map(); // key → { staff, voice }
  let split = false;
  let multiStaff = false;
  for (const part of score.parts) {
    const keys = new Set();
    const staves = new Set();
    for (const m of part.measures) for (const v of m.voices) {
      keys.add(voiceKey(v));
      staves.add(staffOf(v));
      all.set(voiceKey(v), { staff: staffOf(v), voice: v.voice });
    }
    if (keys.size > 1) split = true;
    if (staves.size > 1) multiStaff = true;
  }
  if (!split) return [];
  const num = (s) => Number(s) || 0;
  return [...all].sort(([, a], [, b]) => num(a.staff) - num(b.staff) || num(a.voice) - num(b.voice) || String(a.voice).localeCompare(String(b.voice)))
    .map(([key, { staff, voice }]) => ({
      lo: -Infinity, hi: Infinity, voice: key,
      title: multiStaff ? `Staff ${staff}, voice ${voice}` : `Voice ${voice}`,
    }));
}

/**
 * Build the view.
 * o: { rests, mergeTies, coalesce, sections, selected: Set<id> } (a non-empty selection limits the view to those notes)
 * A section keeps notes in its pitch range [lo, hi) and, when it names a voice, only that voice's notes.
 * Returns [{ section, noteCount, parts: [{ name, eventCount, measures: [{ number, voices: [{ voice, events }] }] }] }]
 * where each event is { notes: [r], rest, grace, count, ids } and r is
 * { note, name, text, image, key }.
 */
export function buildView(score, rules, o) {
  const selecting = o.selected.size > 0;
  return o.sections.map((range) => {
    let noteCount = 0;
    const parts = score.parts.map((part) => {
      const measures = part.measures.map((m) => ({ number: m.number, voices: new Map() }));
      const last = new Map(); // voice key → last displayed event, for coalescing
      let eventCount = 0;

      part.measures.forEach((m, mi) => {
        for (const v of m.voices) {
          const vKey = voiceKey(v);
          if (range.voice != null && vKey !== range.voice) continue;
          for (const chord of v.events) {
            let notes = chord.filter((n) => {
              if (o.mergeTies && n.tieStop) return false;
              if (n.rest) return true;
              if (n.midi == null) return range.lo === -Infinity && range.hi === Infinity;
              if (n.midi < range.lo || n.midi >= range.hi) return false;
              if (selecting && !o.selected.has(n.id)) return false; // only selected notes are shown
              return true;
            });
            if (!notes.length) continue;
            const rest = notes.every((n) => n.rest);
            if (rest && (!o.rests || selecting)) continue; // a selection shows only the selected notes
            if (!rest) notes = notes.filter((n) => !n.rest);

            const resolved = notes.map((note) => {
              const r = resolve(rules, note);
              return { note, name: noteName(note), text: r.value?.text ?? null, image: r.value?.image ?? null, key: r.key };
            });
            const ev = { notes: resolved, rest, grace: notes.every((n) => n.grace), count: 1, ids: notes.map((n) => n.id) };

            // Coalesce: same pitches as the previous shown event in this voice.
            const sig = rest ? null : resolved.map((r) => r.note.midi).sort((a, b) => a - b).join(',');
            const prev = last.get(vKey);
            if (o.coalesce && sig != null && prev && prev.sig === sig) {
              prev.ev.count++;
              prev.ev.ids.push(...ev.ids);
              continue;
            }
            last.set(vKey, { sig, ev });

            const out = measures[mi].voices;
            if (!out.has(vKey)) out.set(vKey, { voice: v.voice, events: [] });
            out.get(vKey).events.push(ev);
            eventCount++;
            if (!rest) noteCount += resolved.length;
          }
        }
      });
      return {
        name: part.name,
        eventCount,
        measures: measures.map((m) => ({ number: m.number, voices: [...m.voices.values()] })),
      };
    });
    return { section: range, noteCount, parts };
  });
}
