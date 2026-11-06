# Privacy

What Storymap to GitHub reads, keeps and sends, and where. Last updated: 6 November 2026.

## What it reads

- **The FigJam page you run it on**: stickies, sections, shapes with text and connectors, to read the story map. Nothing leaves Figma except what the next sections list.
- **The GitHub repository and project board you pick**: issues, milestones, issue templates, issue types, and the board's items and fields (status, sprint, size). It reads them with your GitHub account.

## What it keeps, and where

| What | Where | Who can see it |
|---|---|---|
| Your GitHub token, your role, your language, the repository and board of each file | Figma's plugin storage on your computer (`figma.clientStorage`) | You only |
| Links between stickies and issues, drafts, differences kept on purpose, the start of the week, who does what | Inside the FigJam file, as plugin data | Everyone who can open the file |

Signing out deletes the token from your computer. The token stays valid on GitHub until you revoke it in [GitHub's application settings](https://github.com/settings/applications).

## What it sends

- **To GitHub (`api.github.com`)**: the requests that read your repository, and, only when you click and only in a repository where your team allowed writing, the issues, drafts, sizes and changes you confirm.
- **To the sign-in relay (`storymap-auth…workers.dev`)**: when you press Connect with GitHub, the plugin asks GitHub for a sign-in code through a small relay, because GitHub's sign-in endpoints refuse calls from a plugin window. The relay forwards two requests to `github.com/login` and passes GitHub's answer back, which includes your token. It keeps nothing: no storage, no logs (logging is turned off), no secret. It runs on Cloudflare Workers, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). Its code is in [`relay/`](../relay/index.js).

Nothing is sent anywhere else. There is no analytics, no tracking and no advertising.

## Not affiliated

Storymap to GitHub is not made, endorsed or supported by GitHub or Figma.

## Contact

[SUPPORT CONTACT: an email address or a link]
