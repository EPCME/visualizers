# visualizers

**Note Visualizer** shows every note of a MusicXML score as the text you've mapped it to. For example, every G might become "cheese".

It's a static, client-side-only app. There's no build step and no server. Files you choose never leave your browser.

## Use it

1. Load a score: a `.musicxml`, `.xml` or compressed `.mxl` file, either by choosing a file or by pasting a URL.
2. Load a mapping file the same way, or edit it in place on the page.
3. Read the result by measure or as continuous text. You can also copy it as plain text.

Preload both files with `?score=<url>&map=<url>`. The app needs CORS-friendly URLs, such as `raw.githubusercontent.com` or Gists.

## Mapping format

```
# comments start with # or //
C = cheese
G = grape
F# = falafel      // sharps/flats: #, b, ##, bb, ♯, ♭
G5 = gouda        // one octave only; beats the plain G rule
rest = (pause)
* = ?             // fallback for anything unmatched
```

JSON is accepted too: `{"G": "cheese", "F#": "lime"}`.

Each note is matched from the most specific rule to the least: spelling plus octave (`F#4`), then spelling (`F#`), then the enharmonic equivalent (`Gb4`, `Gb`), then `*`. Notes that match nothing are shown by name and highlighted.

See `examples/` for a sample score and mapping.

## Develop

Serve the folder with any static server, for example `python3 -m http.server`, and open it in a browser. ES modules don't load over `file://`.

- `src/musicxml.js`: MusicXML and `.mxl` parsing (DOMParser plus a tiny zip reader using `DecompressionStream`)
- `src/mapping.js`: mapping-file parsing and note resolution
- `src/app.js`: UI
