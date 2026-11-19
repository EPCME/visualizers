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

/** Ranges from thresholds: [lo, hi), with labels. One unbounded range when there are no thresholds. */
export function rangesFrom(points) {
  if (!points.length) return [{ lo: -Infinity, hi: Infinity, label: null }];
  const ranges = [{ lo: -Infinity, hi: points[0].midi, label: `below ${points[0].label}` }];
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1];
    ranges.push({
      lo: points[i].midi,
      hi: next ? next.midi : Infinity,
      label: next ? `${points[i].label} up to (not incl.) ${next.label}` : `${points[i].label} and above`,
    });
  }
  return ranges;
}

/**
 * Build the view.
 * o: { rests, mergeTies, coalesce, ranges, selected: Set<id> } (a non-empty selection limits the view to those notes)
 * Returns [{ range, noteCount, parts: [{ name, measures: [{ number, voices: [{ voice, events }] }] }] }]
 * where each event is { notes: [r], rest, grace, count, ids } and r is
 * { note, name, text, image, key }.
 */
export function buildView(score, rules, o) {
  const selecting = o.selected.size > 0;
  return o.ranges.map((range) => {
    let noteCount = 0;
    const parts = score.parts.map((part) => {
      const measures = part.measures.map((m) => ({ number: m.number, voices: new Map() }));
      const last = new Map(); // voice key → last displayed event, for coalescing

      part.measures.forEach((m, mi) => {
        for (const v of m.voices) {
          const vKey = (v.staff ? `${v.staff}:` : '') + v.voice;
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
            if (!rest) noteCount += resolved.length;
          }
        }
      });
      return {
        name: part.name,
        measures: measures.map((m) => ({ number: m.number, voices: [...m.voices.values()] })),
      };
    });
    return { range, noteCount, parts };
  });
}
