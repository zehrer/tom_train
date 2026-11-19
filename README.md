# tom_train

Build a railway in 3D and ride along in the driver's cab. Runs entirely in the browser (React, three.js, Vite).

## Modes

- **Editor**: the track runs through control points, as a loop or as a line with two ends. Drag the points, add (`A`) or delete (`⌫`) points, raise or lower them (`PgUp`/`PgDn`) to build bridges, and put a station with a town on a point (`T`). Templates: Line with towns, Oval, Figure eight, Hills. Red rings mark tracks that cross without enough height. The train stays where it is while you edit.
- **Simulator**: the train runs on the track, brakes for every station, waits there and leaves when the exit signal turns green. On a line it reverses at the ends (the loco then pushes and the cab view moves to the other end). Start/stop (`Space`), speed (`↑`/`↓`), wagons (`+`/`−`), cameras: cab (`1`), follow (`2`), overview (`3`).
- **Planned**: switches and block signals (a track network instead of a single line), and a game mode with a small economy.

The track and settings are saved in the browser (localStorage).

## Development

```bash
npm install
npm run dev     # http://localhost:5173 (the preview config uses 5174)
npm test
npm run build
```

GitHub Pages deployment (`.github/workflows/deploy.yml`) runs only when started by hand (`gh workflow run deploy.yml`), so only released versions go online.
