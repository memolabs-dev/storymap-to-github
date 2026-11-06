# Agents

- Check: `npm test` (node:test on `src/core.js`) and `npm run build` (type check and bundle, writes `manifest.json` and `build/`).
- Create Figma Plugin with Preact: `src/main.ts` (Figma code), `src/ui.tsx` (window), `src/core.js` (board logic, no Figma API, typed in `src/core.d.ts`). Follow its docs: https://yuanqing.github.io/create-figma-plugin/
- The plugin never writes to GitHub. On the board it only writes its own labels (plugin data `storymap-label`), when the switch is on. Hand-made links live in `figma.clientStorage`.
- Figma plugin docs: https://developers.figma.com/docs/plugins/ (manifest, network access, FigJam nodes).
- Regime A: small commits on `main`, Conventional Commits, no PR.
- No real board content or names in fixtures: use made-up examples.
