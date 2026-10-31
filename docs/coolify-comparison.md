# yeah compared with Coolify

A feature comparison against Coolify **v4.5.3** (the reference checkout used for the template catalog), written from its source (`app/Livewire`, `routes`, `DESIGN.md`) and checked against this repository. It replaces the older notes in [coolify-research.md](coolify-research.md), which describe Coolify 4.1.2.

The goal is not to copy Coolify. Where a gap matters for the target use (a small VPS running many projects) it is listed with a priority; where yeah deliberately differs it says so.

Priorities: **P0** blocks a normal first-day experience, **P1** is a real productivity or security gap, **P2** is nice to have.

## Where yeah already matches or goes further

- Applications from Git (public, GitHub App, GitHub/GitLab/Gitea sources, deploy keys), Docker image, Dockerfile, Compose, Nixpacks, Railpack, static sites; previews per pull request; rollback (by redeploy or by retained image).
- Databases: PostgreSQL, MySQL, MariaDB, MongoDB, Redis, KeyDB, Dragonfly, ClickHouse and SQLite, with scheduled backups, S3, restore and import.
- 380 service templates (imported from Coolify's catalog), custom Compose stacks, per-container domains.
- Agentless by design: no daemon on the managed server (Coolify installs Sentinel).
- Things Coolify does not have: an MCP server and a CLI, a scoped token API with OpenAPI, the optional memory guard, scale to zero for any application, per-server proxy error page and maintenance mode for services, passkeys with team-wide 2FA enforcement, an audit log that records the client IP and API-token actions.

## Gaps

### P0

| Gap | Coolify | yeah today |
|---|---|---|
| **Domain and HTTPS for the panel itself** | *Settings → Instance domain*: Coolify serves itself through its Traefik with a Let's Encrypt certificate. | **Done**: *Settings → Panel domain* routes the domain through the panel server's Traefik (see [installation.md](installation.md)). The certificate request itself is not verified yet. |
| **First-run onboarding** | A boarding wizard: add a server (or use localhost), set the domain, create the first resource. | **Done**: a *Get started* checklist on the dashboard (server, proxy, first resource, panel domain), derived from the real state and dismissable. Not a modal wizard. |
| **Password reset and instance e-mail** | Instance-level SMTP, password reset, e-mail verification, invitations by e-mail. | **Partly done**: `yeah reset-password` on the host (new password, sessions ended, optional 2FA off; see [troubleshooting.md](troubleshooting.md)). There is still no instance-level SMTP, e-mail verification or reset link. |
| **Backup of the panel itself** | *Settings → Backup*: the panel's own database to S3 on a schedule. | **Done**: *Settings → Panel backup* (daily to S3, retention, back up now, failure notification) plus the dump taken before `yeah update`. |

### P1

| Gap | Coolify | yeah today |
|---|---|---|
| Multi-user teams | Invitations (link or e-mail), roles (owner, admin, member), member management. | Single admin, a documented product decision (see *Not planned* in the roadmap). The `team_members.role` and invitation tables exist but no routes use them. Worth revisiting for a public project. |
| SSO / OAuth login | GitHub, Google, Azure, Authentik, Discord and more, configured in *Settings → OAuth*. | Password, TOTP and passkeys only. |
| Pre/post-deployment commands | Run a command in the container before or after a deploy (migrations, cache warm-up). | Not available; scheduled tasks are the closest thing. |
| Custom proxy configuration | Editor for Traefik dynamic files, per-application custom labels, certificate list, proxy logs. | Proxy logs and the error page only; no editor, no certificate view. |
| Active-deployments indicator and fleet view | Live indicator in the top bar, fleet-wide metrics, dashboard charts. | Dashboard shows counts and recent deployments; metrics are per server. |
| Per-server terminal switch | *Security → Terminal access* turns the web terminal off per server. | The terminal is always available to team members. |
| Cloud-init scripts and provider tokens | Reusable cloud-init scripts, tokens page, Hetzner / DigitalOcean / Vultr / Hostinger. | Hetzner, DigitalOcean and Vultr. No Hostinger, no script library. |

### P2

- Visual canvas of projects, environments and resources.
- Docker Swarm (a single-node evaluation is on the roadmap), user-defined Docker networks ("Destinations"), GitHub self-hosted runners, moving a server between teams.
- Secret-manager links (planned in both projects).
- Database init scripts.
- Custom themes beyond light and dark.

## Interface

Coolify's `DESIGN.md` describes a compact system worth learning from, without copying its brand colour:

- **Density**: 13–14 px text, 32 px controls, small radii. The data is the focus, not the chrome.
- **Depth through surfaces** (canvas, card, inset well, control) with 1 px borders and very soft shadows, instead of heavy boxes.
- **Dark gray, not black**, with one accent colour and a clear primary / dim / faint text ladder.
- **Tactile controls** (a 2 px bottom edge, a 1 px lift on hover) and a command palette.

yeah already has a dark theme, a command palette (Ctrl+K), a collapsible sidebar and English/Portuguese. A sidebar bug that hid every section except Dashboard on the landing page was fixed while writing this comparison. The remaining UI work is a token pass (spacing, surfaces, a light theme that is not an afterthought) rather than new pages.

## What this means for the order of work

1. P0 first, because they are what a person hits in the first hour: a domain with HTTPS for the panel, a first-run guide, password reset, and a backup of the panel's own database.
2. Then the P1 items that change who can use it: invitations with roles, SSO, pre/post-deploy commands.
3. The footprint on small servers is tracked separately in [small-server.md](small-server.md).
