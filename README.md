## Structure Viewer

A small web app to visualize a nested JSON structure as an interactive, searchable tree.

### Live URL
- @https://structure-viewer-5hxxx4mcj-gil-ecksteins-projects.vercel.app/

### Prerequisites
- Node.js 18+
- Yarn

### Install
```bash
yarn
```

### Run (development)
Serve the static files locally (required for fetch to work).
```bash
yarn start
```
Then open the URL shown in the terminal (usually `http://localhost:5173`).

### Project structure
- `index.html` — App entry HTML
- `app.js` — Main UI logic rendering the JSON structure
- `styles.css` — Styles for the tree and controls
- `632251_*.json` — Example JSON used by the app

### Usage notes
- Use the "Load default JSON" button to load the included example.
- You can also upload your own JSON using the file picker.
- Opening `index.html` directly from the filesystem won't work due to browser restrictions on `fetch` for `file://` URLs. Use `yarn start` instead.
