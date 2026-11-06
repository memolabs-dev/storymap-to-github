# Agents

- Check: `npm test` (node:test on `src/core.js`) and `npm run build` (type check and bundle, writes `manifest.json` and `build/`).
- Create Figma Plugin with Preact: `src/main.ts` (Figma code), `src/ui.tsx` (window), `src/core.js` (board logic, no Figma API, typed in `src/core.d.ts`). Follow its docs: https://yuanqing.github.io/create-figma-plugin/
- The plugin never writes to GitHub. On the board it only writes its own labels (plugin data `storymap-label`), when the switch is on. Links live on each sticky as plugin data `link:<owner/repo>` (issue number, 0 for not on GitHub yet).
- Figma plugin docs: https://developers.figma.com/docs/plugins/ (manifest, network access, FigJam nodes).
- Regime A: small commits on `main`, Conventional Commits, no PR.
- No real board content or names in fixtures: use made-up examples.
- Try changes on copies only: a FigJam copy and the private test repository `memolabs-dev/storymap-sandbox` (project 7). Never write to a team's real board or repository.
