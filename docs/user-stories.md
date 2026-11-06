# User stories: the product manager

The first user is a product manager who plans in FigJam and is new to GitHub Projects. They write user stories with a persona and acceptance criteria in the issue text, own the size of each issue, and keep the issue titles in the words of the map. The tech lead owns the split, the labels and "ready"; developers own assignment and progress.

Each story is checked in Figma on a copy of a board, against a test repository. Status as of 2026-11-06.

| # | As a product manager, I want to… | So that… | Status |
|---|---|---|---|
| 1 | connect the board to our repository without knowing what a token is | I can start alone | Done ("Connect with GitHub"). An organisation that restricts OAuth Apps must approve the app first. Not yet tried with another account. |
| 2 | see which stickies already are issues | I know what is left to write | Done: badges in the tree, labels on the board, "x of y linked" |
| 3 | turn a sticky into an issue that carries my user story | the issue says what to build and how we will accept it | Done: the preview has an editable text, prefilled from the repository's template (persona, want, so that, acceptance criteria) |
| 4 | set the size of an issue from the board | I keep my estimates where I plan | Done: the card of a linked sticky sets the size on the project board (its Size field), or clears it, when the plugin may write |
| 5 | see where the work stands: sprint, status, who is on it | I can answer "where are we?" without opening GitHub | Done, read only |
| 6 | know where the map and GitHub disagree, and who changed what | the weekly starts from facts | Done: Differences and "Why?" |
| 7 | rename the issue when the map is right | titles stay in the words of the map | Done: each difference offers "the map is right" (rename the issue, set its milestone, move it under its parent), "Rename the sticky" for a title, and "Keep both", which hides it until either side changes |
| 8 | not change the tech lead's fields by mistake | each role keeps its fields | Done: each person picks a role (product manager, tech lead, everyone) in the GitHub tab; the plugin only offers that role's changes and says who to ask for the others. The split is a team setting under More settings (default: the product manager creates issues, sets sizes, titles and milestones; the tech lead moves issues under a parent). A guard against mistakes, not a security boundary. To confirm at the weekly |
| 9 | publish a batch of stickies after reviewing them | a new release becomes issues in one go | Done: Differences, "On the map only", tick the stickies (none ticked at first; "Tick the new ones" leaves out those that look like an existing issue), then "Create N issues", parents first |
| 10 | see what moved since last week | the weekly is quick | Done: "Start the week now" in Differences saves a snapshot in the file; from then on the issues created, closed, reopened, or changed (title, milestone, status, sprint, size, assignees) show with before and after, for the whole team |
| 11 | start a new map with a guided template | a new team gets going without help | Done: on a page with no map, "Add a story map template" lays out Figma's rows (User Persona, Activities, Tasks, Release 1, Release 2) with an example sticky each; the plugin reads it back by rows and the guide takes over. Tried in Figma on a new empty FigJam file |

## Acceptance criteria

**3. A sticky becomes an issue with its user story**
- The card of a sticky with no issue shows the issue text, editable, before anything is written.
- The text starts from the repository's template; `{title}`, `{parent}`, `{release}` and `{steps}` are filled in.
- What is written in the card is what the issue says on GitHub.
- The template is a setting of each repository, under More settings; an empty template falls back to the default.
