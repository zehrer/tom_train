# tom_train

**Live app: https://zehrer.github.io/tom_train/**

Build a railway in 3D and ride along in the driver's cab. Runs entirely in the browser (React, three.js, Vite).

## Modes

- **Editor**: the railway is a network of points joined by tracks. A point with three tracks is a **switch**, a point with one track ends at **buffers**.
  - Drag points; tap/click a point or a track to select it.
  - **+ Track** (`A`) lays new track from a track end; on a plain point it branches off and makes a switch; on a selected track it adds a point.
  - **Connect** (`C`) joins the selected point to the next one you pick (passing loops, closing a loop).
  - **Delete** (`⌫`), **Height** (`PgUp`/`PgDn`) for bridges, **Station** (`T`) for a station with a town.
  - Templates: Network with switches, Line with towns, Oval, Figure eight, Hills. Red rings mark tracks that cross without enough height. The train stays where it is while you edit.
- **Simulator**: the train brakes for every station, waits, and leaves when the exit signal turns green. It follows the switches and reverses at buffers (the loco then pushes and the cab view moves to the other end). Turn switches by tapping their lever (yellow strip = set way) or with **W** / the switch button for the next switch ahead. Start/stop (`Space`), speed (`↑`/`↓`), wagons (`+`/`−`), cameras: cab (`1`), follow (`2`), overview (`3`).
- **Trains**: up to 20 at once, as many as the track has room for. Four types: steam train (80 km/h), diesel freight (100 km/h), electric passenger train (140 km/h) and high-speed train (200 km/h, a power car at each end). Every train keeps its distance to the train ahead and waits in front of switches another train is using; switches turn by themselves towards a free track (passing loops), and when two trains meet head-on, one backs off. Pick a train with ‹ ›, `N` or by tapping it; the cameras, wagon count and switch button follow it.
- **Touch (iPad)**: one finger turns the view, two fingers zoom and move it; points can be dragged with a finger; every action has a button.
- **Phone**: on small screens the 3D view fills the screen; a slim top bar has the mode switch and a ☰ menu, the most important buttons float at the bottom, and ⋯ opens the full toolbar.
- **Landscape**: the ground, forests, meadows and farmhouses go on to the horizon. They are generated from the position alone, so the same place always looks the same and nothing needs to be stored.
- **Planned**: a game mode with a small economy.

## Saving, export and import

- **File → Save / Save as… / Open…** (`⌘S` / `⌘O`): a library of named tracks kept in the browser. The working state is also kept between visits.
- **File → Export as HTML**: one self-contained HTML file with a map of the track that opens in any browser (printable, easy to send). The track is embedded in the file; its **Open in tom_train** button hands it to the app.
- **File → Import**: opens exported HTML files (or JSON) and adds them to the library.

## Development

```bash
npm install
npm run dev     # http://localhost:5173 (the preview config uses 5174)
npm test
npm run build
```

GitHub Pages deployment (`.github/workflows/deploy.yml`) runs only when started by hand (`gh workflow run deploy.yml`), so only released versions go online.
