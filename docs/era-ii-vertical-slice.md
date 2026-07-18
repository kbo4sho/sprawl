# Era II vertical slice

This prototype proves the local-studio-to-public-player boundary without changing the current live route or invoking an image model.

## What it proves

- Two immutable synthetic epochs with 20,000 persistent point identities
- Exact position and color continuity between consecutive epochs
- Precomputed cubic motion paths, color memory, delays, durations, and decay
- Content-addressed binary artifacts verified by SHA-256 in the browser
- Globally synchronized progress derived from the published epoch clock
- WebGL-only playback with no runtime point matching or generation
- Temporary cursor disturbance that never changes saved state
- Atomic holding-manifest publication and byte-exact rollback
- Desktop and mobile rendering from the same composition data

## Local preview

Start the existing server:

```sh
npm start
```

Then open:

- Global-clock state: `http://localhost:3500/era2/`
- Short proof replay: `http://localhost:3500/era2/?demo=1`

The `/era2/` path is isolated from the current public experience.

## Artifact layout

```text
public/era2/
├── app.js
├── index.html
├── styles.css
└── data/
    ├── live.json
    └── epochs/era-02/
        ├── epoch-000001/
        └── epoch-000002/
```

Each epoch directory contains readable metadata, a static SVG preview, a checksum, and a 1,120,016-byte binary point bundle. The point record order is the permanent identity order.

The private sibling repository `sprawl-studio` generates and validates these files. The public repository contains no private intention, critique, rejected attempt, or model input.
