# Brand

The icon is a sticky and the issue label the plugin puts in its corner: what the plugin does that no other one does.

| File | Use |
|---|---|
| `icon.svg` | The icon, the source of every other file. |
| `icon-128.png`, `icon-256.png`, `icon-512.png` | The Figma Community icon (128 recommended) and larger copies. |
| `cover.png` | The Figma Community thumbnail, 1920 × 1080. Drawn from `cover.html`. |
| `tokens.css` | The colours and fonts, as CSS variables. |

Run `bash brand/render.sh` after changing `icon.svg` or `cover.html`. It draws the PNG files with headless Chrome.

## Colours

- Ink `#1B1F24`: text, and the ground of the icon.
- Canvas `#F4F5F7`: page ground, like the FigJam canvas.
- Linked `#1A7F37`: "linked to GitHub", and actions. Nothing else is green.
- The kinds, as in the plugin: epic `#F5C33B` (the sticky), feature `#4BA3F7`, task `#A77BF3`, note `#F07FB5`.

## Type

Bricolage Grotesque 800 for the name and titles, Atkinson Hyperlegible for text, JetBrains Mono for issue labels such as `#19 · Sprint 1 · Ready`. In the name, `to` is lighter so the two words that matter stand out.

## Not used

No Figma or GitHub logo, colour or shape. The name says GitHub because that is what the plugin connects to; check GitHub's and Figma's brand rules before listing it on Figma Community.
