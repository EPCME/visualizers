# visualizers

**Note Visualizer** shows every note of a MusicXML score as the text you've mapped it to. For example, every G might become "cheese".

It's a static, client-side-only app. There's no build step and no server. Files you choose never leave your browser.

## Use it

1. Load a score: a `.musicxml`, `.xml` or compressed `.mxl` file, either by choosing a file or by pasting a URL.
2. Build the mapping on the page: one row per rule, each replacing a note with **text or a picture**. A picture can be uploaded or linked by URL. You can also start from a preset (foods, animal pictures, or D-major solfège from `examples/`), load a mapping file, or edit the mapping as text. Your mapping is remembered in the browser, and **Download mapping** saves it as a file.
3. Read the result by measure or as continuous text. You can also copy it as plain text.
4. Optionally:
   - **Select notes** on the engraved score (rendered by [Verovio](https://www.verovio.org/)) by clicking them or dragging a box. While a selection exists, only the selected notes are shown in the mapped view.
   - **Split at pitches**: enter thresholds such as `C4, G5` to divide the mapped view into one section per pitch range ([lo, hi)).
   - **Split by voice**: offered when a part has more than one voice. Shows one section per staff and voice.
   - **Measures per line**: every section and part uses the same columns, so a given measure is in the same place in each. **Auto** fits as many as the width allows.
   - **Coalesce repeated notes**: 2+ adjacent notes of the same pitch in a voice are shown as one.

Preload both files with `?score=<url>&map=<url>`. The app needs CORS-friendly URLs, such as `raw.githubusercontent.com` or Gists.

## Mapping format

```
# comments start with # or //
C = cheese
G = grape
F# = falafel      // sharps/flats: #, b, ##, bb, ♯, ♭
G5 = gouda        // one octave only; beats the plain G rule
A = ![apple](https://example.com/apple.png)   // a picture; the [label] is optional
rest = (pause)
* = ?             // fallback for anything unmatched
```

JSON is accepted too: `{"G": "cheese", "A": {"image": "https://…/apple.png", "text": "apple"}}`.

Pictures uploaded in the editor are shrunk to at most 240px and embedded as `data:` URLs, so a downloaded mapping is self-contained.

Each note is matched from the most specific rule to the least: spelling plus octave (`F#4`), then spelling (`F#`), then the enharmonic equivalent (`Gb4`, `Gb`), then `*`. Notes that match nothing are shown by name and highlighted.

See `examples/` for a sample score and mapping.

## Develop

Serve the folder with any static server, for example `python3 -m http.server`, and open it in a browser. ES modules don't load over `file://`.

- `src/musicxml.js`: MusicXML and `.mxl` parsing (DOMParser plus a tiny zip reader using `DecompressionStream`)
- `src/mapping.js`: mapping-file parsing and note resolution
- `src/view.js`: selection filtering, pitch-range sections, coalescing
- `src/engrave.js`: Verovio engraving (CDN, pinned 6.3.0) and note selection
- `src/editor.js`: on-page rule editor (rows ↔ mapping text)
- `src/app.js`: UI


## Acknowledgements

1. https://openclipart.org/detail/355536/rainbow-color-animated-heart
2. https://openclipart.org/detail/310847/turkey-turkey-outline
3. https://openclipart.org/detail/232703/thanksgiving-turkeyture
4. https://openclipart.org/detail/27563/little-penguin
5. https://openclipart.org/detail/17702/cartoon-bear
6. https://openclipart.org/detail/17637/cartoon-sheep
7. https://openclipart.org/detail/17595/cartoon-squirrel
8. https://openclipart.org/detail/17635/cartoon-elk
9. https://openclipart.org/detail/17683/cartoon-cat
10. https://openclipart.org/detail/17824/cartoon-goat
11. https://openclipart.org/detail/17676/cartoon-cow
12. https://openclipart.org/detail/17624/cartoon-gnu
13. https://openclipart.org/detail/17628/cartoon-giraffe
14. https://openclipart.org/detail/17575/cartoon-kangaroo
15. https://openclipart.org/detail/17566/cartoon-owl
16. https://openclipart.org/detail/17814/cartoon-beaver
17. https://openclipart.org/detail/17810/cartoon-elephant
18. https://openclipart.org/detail/17692/cartoon-dog