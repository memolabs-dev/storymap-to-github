# Agents

- Check: `npm test` (node:test, no dependencies). UI check: serve the folder, open `dev/preview.html`.
- Plain JavaScript, no build. `code.js` keeps its pure functions at the top so node:test can load them; the Figma glue sits under `typeof figma !== 'undefined'`.
- The plugin writes nothing to GitHub or to the board in this slice. Hand-made links live in `figma.clientStorage`.
- Figma plugin docs: https://developers.figma.com/docs/plugins/ (manifest, network access, FigJam nodes).
- Regime A: small commits on `main`, Conventional Commits, no PR.
- No real board content or names in fixtures: use made-up examples.
