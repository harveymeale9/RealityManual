# AGENTS.md

This file is the fast-onboarding entry point for any coding agent working
in this repository — written for OpenAI Codex specifically (Harvey is
installing it alongside Claude Code on the same VPS, both expected to
operate with full repo + host access), but useful to any agent picking
this project up cold.

**Read [`CLAUDE.md`](./CLAUDE.md) in full before doing anything non-trivial.**
It is the actual, continuously-updated source of truth for this project —
architecture decisions, every bug that's been found and fixed (with root
causes, not just patches), infrastructure layout, credentials policy, and
Harvey's own standing preferences. It is long (150+ numbered sections,
still growing) because this project has a firm convention: **whoever makes
a real change writes up what changed and why, in CLAUDE.md, before
considering the task done.** This file does not replace that — it's a map
to it, plus a few things specific to a new agent joining an already-running
multi-agent setup.

If anything in this file and CLAUDE.md ever disagree, CLAUDE.md wins —
update this file to match, not the other way around.

---

## 1. What this project actually is

**The Reality Manual** — a single-product ecommerce site selling one book
(`realitymanual.com`), plus an internal content-production/social-posting
tool for marketing it (`ops.realitymanual.com`, branded "Content Studio").
Three independent codebases in this one repo, deliberately not sharing
data or infrastructure with each other:

```
frontend/       Storefront static site (plain HTML/CSS/JS, no build step)
                Deploys via GitHub Pages (.github/workflows/static.yml)
                on every push to main. Cloudflare sits in front as DNS/CDN
                only — NOT the separate "Cloudflare Pages" product. Don't
                touch static.yml assuming otherwise (see CLAUDE.md §10).

backend/        Storefront's own backend (Stripe, BookVault fulfillment,
                first-party analytics). Node/Express + SQLite. Deployed
                as a Docker container on the VPS at api.realitymanual.com.
                Manual redeploy — no CI for this one (see CLAUDE.md §65).

ops-service/    "Content Studio" — Harvey's internal tool for planning,
                producing, and publishing marketing videos to YouTube/
                TikTok/etc, PLUS "Project Manager": a persistent, headless
                Claude Code agent Harvey talks to by voice/text from his
                phone or desktop. Node/Express + better-sqlite3. Deployed
                as a Docker container (rm-ops-service) at
                ops.realitymanual.com, with CI auto-deploy on push (see
                §5 below for the important nuance in how that deploy
                script decides whether to actually rebuild).
```

Everything about the storefront lives in CLAUDE.md §1-73. Everything about
ops-service/Content Studio (which is where almost all the recent, active
work has been) is §62 onward.

---

## 2. This repo is being worked on by multiple agents concurrently, right now

Not a hypothetical — this is the actual current state, and it's been true
for a while (CLAUDE.md §76 already documents earlier concurrent-session
incidents). At any given time there may be:

- Harvey's own interactive terminal session(s) on the VPS.
- A non-root `ubuntu` Remote Control session doing day-to-day work.
- The headless "Project Manager" agent — a persistent, resumed Claude Code
  session living **inside the `rm-ops-service` Docker container itself**,
  triggered by Harvey's voice/chat app. It has real git push rights to
  this repo and real SSH access to the VPS host. Several of the most
  detailed CLAUDE.md sections (especially the 140s-150s) are literally
  this agent narrating its own work in first person, mid-session.
- CI's own automated deploy runs.
- Now, apparently, Codex too.

**Practical consequences:**
- Always `git fetch`/`pull` and re-read CLAUDE.md before assuming you have
  the full picture — a commit you don't recognize is not necessarily
  wrong or stale, it may just be a different agent's work you haven't
  seen yet (CLAUDE.md §76's explicit lesson).
- There are **two separate clones of this repo on the VPS**, on purpose:
  `/root/realitymanual-repo` (Harvey's/interactive sessions' own working
  copy, also what the ops-service deploy script pulls from) and
  `/srv/realitymanual-repo` (a dedicated clone for the headless Project
  Manager container, owned by uid 1000, bind-mounted into that
  container). Don't casually merge these or assume one is authoritative
  over the other — they're kept deliberately separate so the unattended
  agent's tree never collides with interactive work in progress. See
  CLAUDE.md §74 for the full reasoning, and §82 for a real incident
  caused by uncommitted local changes sitting in `/root/realitymanual-repo`
  silently blocking the entire ops-service deploy pipeline for a full
  session before anyone noticed — check `git status` there before
  assuming a clean pull.
- **After any `ops-service` push, don't assume "pushed" means "live."**
  Check `ops-service/.ci/last-run.log` (committed by CI itself after each
  deploy attempt) for the actual outcome. This has silently failed before
  (§82) in a way that looked identical to success from the git log alone.

---

## 3. VPS / host access

Same Hostinger VPS runs n8n, `rm-ops-service`, and the storefront
`backend/` container, all as separate Docker containers. If you're running
*inside* one of these containers (e.g. as the headless Project Manager
does) and need to touch anything outside it — another container, nginx,
the host filesystem — the established pattern is SSH to the host itself,
not a Docker socket mount (a socket mount was considered and deliberately
rejected — see CLAUDE.md §88 for why: opaque escalation, vs. individually
auditable SSH commands):

```bash
ssh ubuntu@host.docker.internal '<command>'
# for anything requiring root:
ssh ubuntu@host.docker.internal 'sudo <command>'
```

`ubuntu` has passwordless sudo. This is functionally full root — treat it
that way, not as some sandboxed lesser access.

**One standing caveat if you are the kind of agent that runs *inside* the
`rm-ops-service` container** (as Claude Code's Project Manager does, and
as Codex might if it's given an equivalent role): rebuilding/restarting
`rm-ops-service` over that same SSH connection kills your own current
process mid-command. It won't get to report success back to you in the
same turn. This is routine, not a sign of failure — but if the *next*
resume wouldn't otherwise make the situation obvious, log where things
stand to `<DATA_DIR>/work-log.md` (mounted at `/data` inside the
container) immediately before triggering it.

**Generating or writing any raw credential (SSH keys, API keys, OAuth
tokens, PATs) is a "you-not-me" action, every time, regardless of how
routine it feels.** This isn't a suggestion this project came to lightly —
it's a hard boundary Claude Code's own safety classifier has enforced
repeatedly here (refusing even read-only checks like `sudo -l -U ubuntu`
with reasons like "Containment Escape"/"Unauthorized Persistence" — see
CLAUDE.md §74/§88/§74's OAuth-token section). Every credential currently
in place on this VPS was generated or pasted in by Harvey directly, in a
human console session, not by an agent running a command. Expect the same
boundary to exist for Codex; don't try to route around it if it does —
ask Harvey to do the raw-credential step himself and continue from there.

---

## 4. Deploying a change

**Storefront frontend (`frontend/`):** push to `main` → GitHub Actions
deploys automatically. No manual step.

**Storefront backend (`backend/`):** no CI. Manual rebuild on the VPS —
see CLAUDE.md §65 for the exact `docker build`/`stop`/`rm`/`run` sequence
and env file location.

**ops-service (`ops-service/`):** CI triggers on every push touching
`ops-service/**`, but — this is important and non-obvious — **a
`public/**`-only change (pure frontend) deploys near-instantly with no
Docker rebuild or container restart at all**, because `server.js` serves
its static files straight from the live git working tree on the VPS
(`/srv/realitymanual-repo` inside the container), not a copy baked into
the image at build time. Only a change touching `server.js`, `src/`,
`package.json`/`package-lock.json`, `Dockerfile`, or `deploy.sh` itself
triggers the slower full rebuild+restart path (see CLAUDE.md §93 for the
exact mechanism and why it was built this way — it used to kill the
Project Manager's own in-flight turn on *every single* frontend tweak,
which was the actual motivating complaint). Practically: prefer
frontend-only changes when a fix genuinely is frontend-only, since
they're both faster to see live and don't risk interrupting anything.

Either way, `git pull` alone in `REPO_DIR` is not sufficient by itself for
a rebuild-requiring change — the deploy script has to actually run
`docker build`/recreate the container. See CLAUDE.md §62/§65/§93 for the
exact mechanics per service if you need to trigger this by hand rather
than via CI.

---

## 5. Verification discipline (read this before marking anything "done")

This codebase — specifically the ops-service Kanban board's click/drag
handling — has a long, explicit, embarrassing-if-repeated history of
shipping fixes that were "verified via `node --check`" and were still
completely broken in the real browser (CLAUDE.md §113, §119, §120, §121
are four consecutive failed attempts at the exact same bug, each one
looking correct on inspection). `node --check` only proves JavaScript
*parses*. It says nothing about runtime/DOM/event behavior.

The actual fix pattern that finally worked (§123) was building a real
headless-browser test rig and reproducing the bug for real before writing
any fix. This environment has no root, no apt, no pre-installed browser —
here's the exact working recipe already used multiple times in this repo:

```bash
npm install playwright-core   # installs fine, no root needed
npx playwright install chromium   # downloads a working browser binary

# Chromium needs shared libs this container doesn't have
# (libnspr4, libnss3, libatk*, libcups2, libgtk-3-0, libxcomposite1,
# libxdamage1) and apt/install-deps needs root, which isn't available.
# Workaround: download the individual .deb files directly from
# deb.debian.org (confirm this container's actual Debian version via
# /etc/os-release first, matching the pool you fetch from — a version
# mismatch has caused a real glibc-incompatibility gotcha before) and
# extract them WITHOUT installing:
dpkg-deb -x <package>.deb <scratch-dir>
# then point LD_LIBRARY_PATH at <scratch-dir>'s lib folder before
# launching Chromium.
```

Use this for any "I clicked it and nothing happened" style report before
touching code — it is far cheaper than a second or third guess-and-ship
round. Delete any synthetic test data (pieces/videos/pieces you created
for the test) via the app's own DELETE endpoints afterward, leaving
Harvey's real data untouched.

For anything that isn't UI/DOM (an API route, an auth boundary, a data
migration), a direct `curl`/`fetch` test against the real deployed
service is usually enough and much cheaper — this repo's history has
many examples of exactly that pattern (log into the real service, hit
the real endpoint, read the real response) rather than reasoning from
code alone. Prefer it over guessing whenever the live service is
reachable and the action has no destructive side effect.

---

## 6. Security posture (deliberately relaxed, not accidentally)

Harvey has explicitly and repeatedly asked for low ceremony here: shared
single passwords for internal tools (`ormiston` for the admin panel,
plus a scoped `youtube-reviewer` role added later for an external
platform-review account — see CLAUDE.md §153), no complex auth systems,
"just do the basics." This is a considered decision (CLAUDE.md §44/§46),
not an oversight — don't propose hardening it unprompted.

What *is* treated seriously regardless: real external secrets (Stripe
keys, BookVault API key, YouTube/TikTok OAuth client secrets, ElevenLabs
key, GitHub PATs, the Claude Code OAuth token) are never committed —
they live only in gitignored `.env` files written directly on the VPS.
`.env.example` files document what's needed without real values. Never
log secrets. Never expose backend-only secrets to any frontend. When
building a feature for an external party (like the reviewer-role account
in §153), assume they might use the raw API directly, not just the UI you
built — verify server-side enforcement actually holds, don't rely on a
disabled form field as the real boundary.

---

## 7. Keeping this arrangement working

- Update **CLAUDE.md**, not this file, when something about the project
  itself changes (a new bug found+fixed, a new feature, an infrastructure
  decision). This file should stay short and mostly stable; CLAUDE.md is
  where the real history and detail belongs, by long-established
  convention in this project.
- If you (Codex) develop your own tool-specific operating notes that
  wouldn't apply to Claude Code or a future agent, keep those separate
  and clearly labeled rather than folding them into CLAUDE.md's shared
  narrative — but genuine project facts (what's built, what broke, why a
  decision was made) belong in CLAUDE.md regardless of which agent found
  them, so any agent working here later has the full picture.
- `README.md` at the repo root is stale (still describes an early
  "Phase 1" storefront-only state and doesn't mention ops-service at
  all) — don't treat it as current; CLAUDE.md is the real source of
  truth. Worth a rewrite at some point, but out of scope for this file.
