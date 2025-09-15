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

### Usage notes
- Opening `index.html` directly from the filesystem won't work due to browser restrictions on `fetch` for `file://` URLs. Use `yarn start` instead.

### Load from URL (only)
- Paste a JSON URL in the "Load from URL" field and click the button (or press Enter). The URL is saved to the page's `?url=` query param.
- You can open the app directly with a JSON URL: `?url=https://example.com/your.json`.
- Notes:
  - The URL must be publicly accessible and return valid JSON with appropriate CORS headers if hosted on a different origin.
  - The viewer accepts either a root object that already represents the structure, or an object with a `structure` key. In the latter case, the value of `structure` is used as the tree root.
