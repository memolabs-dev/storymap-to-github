# Figma Community listing

The text and settings to paste when publishing. Images: `brand/icon-128.png` (icon) and `brand/cover.png` (thumbnail, 1920 × 1080). Carousel, up to nine: the screenshots in `docs/images/en/`.

## Name

Storymap to GitHub

## Tagline

Read your FigJam story map as a backlog, and keep it in step with GitHub.

## Description

Plan in a FigJam story map, build in GitHub, and keep the two in step.

Storymap to GitHub reads your map as the backlog it is: epics, features with their steps, tasks and releases, by rows as in Figma's story map template, or by sticky colours. Then, from the board:

- Link each sticky to its issue, and see its status, sprint and size.
- Create issues from the map, one at a time or in a batch, with a preview. The text starts from the repository's own issue template. Product managers can start with a draft on the project board.
- See where the map and GitHub disagree (a renamed issue, another milestone, another parent, a sprint that ends too late) and settle each one.
- See what moved this week, field by field.
- Put a small label on each linked sticky, such as #19 · Sprint 1 · Ready.

Nothing is written to GitHub until you click, and only in repositories where your team allowed it. In English and French.

**You need a GitHub account** that can see the repository, and write access to create issues. Signing in goes through GitHub's device flow: a short code, a click on GitHub. Your organization may have to approve the app.

Guide: [GUIDE LINK]. Privacy: [PRIVACY LINK].

Not made, endorsed or supported by GitHub.

## Category

Productivity (or the closest one offered: project management, developer handoff).

## Network access

Restricted, as declared in the manifest:
- `https://api.github.com`: reads the repository and project board, and writes what you confirm.
- `https://storymap-auth.storymap-authmemolabsworkersdev.workers.dev`: forwards GitHub's sign-in, which refuses calls from a plugin window. It keeps nothing.

## Support contact

[SUPPORT CONTACT]

## Before pressing Publish

- Two-factor authentication is on for the Figma account that publishes.
- The plugin is created in Figma (Plugins › Development › New plugin…, or at publish time), and the id Figma gives replaces `storymap-to-github-dev` in `package.json`, then `npm run build`.
- The guide and privacy pages are reachable by people outside the team: the repository is private, so they need a public home.
- The support contact is filled in, here and in `docs/privacy.md`.
