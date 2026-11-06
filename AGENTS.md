# Agents

- Check: `npm test` (node:test on `src/core.js`) and `npm run build` (type check and bundle, writes `manifest.json` and `build/`).
- Create Figma Plugin with Preact: `src/main.ts` (Figma code), `src/ui.tsx` (window), `src/core.js` (board logic, no Figma API, typed in `src/core.d.ts`). Follow its docs: https://yuanqing.github.io/create-figma-plugin/
- The plugin writes to GitHub only after a click, and only in a repository where the team turned on Can write: issues, drafts on the project board, sizes, and the side picked for a difference. On the board it writes its own labels (plugin data `storymap-label`) when the switch is on. Links live on each sticky as plugin data `link:<owner/repo>` (issue number, 0 for not on GitHub yet), drafts as `draft:<owner/repo>`.
- Figma plugin docs: https://developers.figma.com/docs/plugins/ (manifest, network access, FigJam nodes).
- Regime A: small commits on `main`, Conventional Commits, no PR.
- No real board content or names in fixtures: use made-up examples.
- Try changes on copies only: a FigJam copy and the test repositories `memolabs-dev/storymap-sandbox` (project 7) and `memolabs-dev/storymap-demo` (project 8). Never write to a team's real board or repository.
- Brand files are in `brand/`; redraw the PNG files with `bash brand/render.sh`.
