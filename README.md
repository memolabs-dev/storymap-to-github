# Storymap to GitHub

A FigJam plugin that reads a user story map and shows the GitHub backlog it would become: epics, features with their steps, tasks and milestones. It also marks each item as new or already on GitHub. It writes nothing, neither to GitHub nor to the board.

![The plugin preview on a sample library app story map](docs/preview.jpg)

## Why

Product owners plan in FigJam, developers work in GitHub Issues and Projects, and someone retypes the map by hand. The tools that exist turn one sticky into one issue. This one reads the map as a whole: colours give the kind of item, columns give the parent, release rows give the milestone.

## How it reads a board

- **Colours.** By default, after Jeff Patton's story map: yellow epics, blue activities (features), green steps, violet tasks, pink notes for the product owners. The Legend tab lists every colour found and lets you change what each one means.
- **Columns.** A feature belongs to the nearest epic at or left of it, a step to the nearest feature, a task to the column it overlaps most.
- **Arrows.** An arrow between a task and a feature, step or epic sets the task's parent, whatever the column. An arrow between two tasks makes the lower one a sub-task.
- **Releases.** A section named like a release (`P0`, `MVP`, `Release 1`, `R2`, `v1`, `Sprint 3`) holds its tasks. Otherwise short release tags (`P0`, `MVP`, any colour) label rows, and long horizontal lines, when the board has them, mark where each row starts and ends.
- **Legend and scope.** The whole page, or only the selection if something is selected. A section named `Legend`, and stickies that explain the colours ("Epics and targets", "Steps: …"), are skipped. The Legend tab says what was read on the page.

Comparing with GitHub, in the GitHub tab, reads the issues of a repository and matches titles (case, accents, `Epic:` prefixes and small words ignored). A match is a guess: click a badge to confirm it, pick the right issue, or mark the item as not on GitHub yet. Those choices stay on your computer.

## Drift: where the map and GitHub disagree

Once stickies are linked to issues, the Drift tab lists where the plan and the work no longer say the same thing: a task in another release row than its milestone, an issue under another parent than on the map, a renamed issue, an issue closed as not planned while the map still has it. It also lists the stickies with no issue and the open issues that are not on the map.

**Why?** reads the issue's history on GitHub and says who changed what, and when ("2026-11-05, @someone set the milestone to P0"). Nothing is changed on either side: the team decides which one is right.

## Try it

You need the Figma desktop app; development plugins do not load in the browser.

1. Clone this repository.
2. In FigJam: Plugins, Development, Import plugin from manifest, then pick `manifest.json`.
3. Open the page that holds your story map and run Storymap to GitHub.

To look at the interface without Figma, serve the folder and open `dev/preview.html`, which feeds the plugin UI a sample board:

```bash
python3 -m http.server 8765
```

## Develop

Plain JavaScript, no build step. `code.js` holds the board reading logic and the Figma glue; `ui.html` is the plugin window.

```bash
npm test
```

## Status

First slice: preview only. Next, after validation in the plugin: create the issues, sub-issues and milestones in GitHub Projects, and note each issue number on its sticky.

## License

MIT
