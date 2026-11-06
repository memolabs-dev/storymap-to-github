# Storymap to GitHub

A FigJam plugin that reads a user story map as the GitHub backlog it is, or will become: epics, features with their steps, tasks and milestones. The map and the plugin window answer each other: hover a row to find its sticky, click a sticky to open its card. It shows where the map and GitHub disagree, and can put a small label on each linked sticky. It never writes to GitHub.

![The plugin preview on a sample library app story map](docs/preview.jpg)

## Why

Product owners plan in FigJam, developers work in GitHub Issues and Projects, and someone retypes the map by hand. The tools that exist turn one sticky into one issue. This one reads the map as a whole: rows or colours give the kind of item, columns give the parent, release rows give the milestone.

## How it reads a board

Two conventions, chosen automatically and switchable in the Legend tab:

- **By rows**, as in [Figma's story map template](https://www.figma.com/templates/story-map-example/): labelled rows give the kind of every sticky in them. By default User Persona becomes a note, Activities epics, Tasks features, and each Release row a milestone holding its tasks. Each row's meaning can be changed. Rows are picked automatically when the row labels are about as tall as a sticky, as in the template.
- **By colours**, as many team boards do: each sticky colour gives the kind of item. The rules below apply.

The plugin reads the whole current page and needs edit access to the file: Figma does not run plugins in view-only files.

- **Colours.** By default, after Jeff Patton's story map: yellow epics, blue activities (features), green steps, violet tasks, pink notes for the product owners. The Legend tab lists every colour found and lets you change what each one means.
- **Columns.** A feature belongs to the nearest epic at or left of it, a step to the nearest feature, a task to the column it overlaps most.
- **Arrows.** An arrow between a task and a feature, step or epic sets the task's parent, whatever the column. An arrow between two tasks makes the lower one a sub-task.
- **Releases.** A section named like a release (`P0`, `MVP`, `Release 1`, `R2`, `v1`, `Sprint 3`) holds its tasks. Otherwise short release tags (`P0`, `MVP`, any colour) label rows, and long horizontal lines, when the board has them, mark where each row starts and ends.
- **Legend.** A section named `Legend`, and stickies that explain the colours ("Epics and targets", "Steps: …"), are skipped. The Legend tab says what was read on the page.

## Linking stickies and issues

In the GitHub tab, name the repository and press Compare. Items whose title matches an issue (case, accents, `Epic:` prefixes and small words ignored) are linked. For the others, click the sticky on the board: its card shows the three issues it most likely is, with the words they share, a search box, and "Not on GitHub yet". Those choices stay on your computer.

**Labels on the board.** Once a repository is compared, the "Labels on the board" switch puts a small locked label in the corner of every linked sticky, such as `#19 · Sprint 1 · Ready`. Labels follow their sticky when it moves, are updated on every read, and all go away when the switch is turned off. They are the only thing the plugin writes, and only on the board.

## Drift: where the map and GitHub disagree

The Drift tab lists where the plan and the work no longer say the same thing: a task in another release row than its milestone, an issue under another parent than on the map, a renamed issue, an issue closed as not planned while the map still has it. It also counts the stickies with no issue and lists the open issues that are not on the map.

**Sprints.** Name the GitHub Projects board in the GitHub tab to read each issue's sprint, status and size. Tasks then carry their sprint, the preview filters by sprint, and Drift flags a task whose sprint ends after the due date of its release on the map. GitHub only serves projects through GraphQL, which needs a token that can read projects (classic token: `read:project`).

**Why?** reads the issue's history on GitHub and says who changed what, and when ("2026-11-05, @someone set the milestone to P0"). Nothing is changed on either side: the team decides which one is right.

## Try it

You need Node.js 22 and the Figma desktop app; development plugins do not load in the browser.

```bash
npm install
npm run build
```

Then in FigJam: Plugins, Development, Import plugin from manifest, and pick the `manifest.json` the build wrote. Open the page that holds your story map and run Storymap to GitHub.

## Develop

Built with [Create Figma Plugin](https://yuanqing.github.io/create-figma-plugin/), following its Preact template: `src/main.ts` is the plugin code, `src/ui.tsx` the window, with Create Figma Plugin's Preact components. The board reading logic is in `src/core.js`, free of any Figma API, typed in `src/core.d.ts`, and tested with Node's test runner.

```bash
npm test
npm run watch
```

## Status

Reads, links, compares and labels. Next: publish a sticky as an issue (type, parent, milestone, project) from its card, and a real "Sign in with GitHub" instead of a token.

## License

MIT
