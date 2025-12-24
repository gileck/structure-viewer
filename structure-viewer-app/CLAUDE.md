# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server with Turbopack (http://localhost:3000)
npm run build        # Production build with Turbopack
npm run start        # Start production server
npm run lint         # Run ESLint
```

## Architecture

This is a Next.js 15 (Pages Router) application for viewing Wix site page structures as interactive tree views. It uses TypeScript, React 19, and Tailwind CSS 4.

### Pages

- `/` - Default Next.js landing page
- `/site` - Site loader: Enter a Wix site URL to fetch its page list via `?dumpSiteModels=true` query parameter
- `/viewer?url=...` - Tree viewer: Displays JSON structure from a page URL as an interactive collapsible tree

### API Routes

- `/api/page-json?url=<url>` - Proxy that fetches compressed page JSON from Wix's parastorage CDN
- `/api/site-models?site=<url>` - Proxy that fetches site models (page list) by appending `?dumpSiteModels=true` to site URL

Both proxies send browser-like headers to avoid CDN 403 blocks.

### Key Data Flow

1. User enters site URL on `/site` page
2. App calls `/api/site-models` to get `rendererModel.pageList.pages[]`
3. User clicks a page to navigate to `/viewer?url=<pageJsonUrl>`
4. Viewer fetches page JSON via `/api/page-json`
5. JSON is normalized (`data.structure` if present) and rendered as lazy-hydrated tree

### Viewer Component Structure

The `viewer.tsx` contains the entire tree rendering logic in a single file:
- `TreeRoot` - Entry point that renders the root node
- `ChildrenHydrator` - Imperatively hydrates child DOM nodes on-demand when parent `<details>` opens
- Query resolution: `*Query` properties (e.g., `dataQuery`, `designQuery`) are resolved against data maps like `document_data`, `design_data`, etc.

Tree nodes are created via imperative DOM manipulation (not React) for performance with large JSON structures. Each node shows:
- ID/name with optional naming lookup
- Component type
- Descendant count badge
- Collapsible structure section with resolved properties

### Configuration

`public/config.json` - add data map names to exclude from JSON (affects size calculation and display):
```json
{
  "excludedDataItems": ["document_data", "design_data"]
}
```

Available: `document_data`, `design_data`, `behaviors_data`, `connections_data`, `theme_data`, `layout_data`, `component_properties`, `mobile_hints`, `atomicScopes`, `classnames`, `naming`, `reactions`, `slots`, `variants_data`, etc.

### Path Alias

`@/*` maps to `./src/*`
