# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**The Reality Manual** — a digital grimoire: a 3D page-turning book on desktop, a scrollable stack of leaves on mobile. Static files only — no build step, no dependencies, no framework, no `package.json`. `book.json` is the book; everything else is loose parts.

---

## Reality Manual Production Workflow

The primary source of truth for all book content is:

MANUSCRIPT.md

When MANUSCRIPT.md and the website disagree, MANUSCRIPT.md should be considered correct.

The manuscript is authored, edited, and approved outside of Claude Code.

Do not rewrite manuscript content.

Do not attempt to improve prose.

Do not make editorial decisions.

Assume manuscript text has already been reviewed and approved.

Your responsibility is to faithfully transform the manuscript into website pages while preserving existing Reality Manual conventions.

The manuscript is the product.

The website is the presentation layer.

Your responsibility is implementation, formatting, consistency, structure, navigation, asset integration, and deployment.

---

## Existing Chapters Are Canon

When implementing new manuscript content, first inspect previously completed chapters.

Use existing published chapters as the authoritative reference for:

- page structure
- typography
- image placement
- SVG placement
- pullquote placement
- chapter openings
- ornamental separators
- animation usage
- chapter transitions
- visual rhythm

Consistency is preferred over invention.

When uncertainty exists, inspect existing chapters and follow the established pattern.

---

## Visual Conventions

The visual language of the book is derived from existing published pages.

When implementing new pages:

- preserve existing manuscript aesthetics
- preserve typography conventions
- preserve spacing conventions
- preserve image conventions
- preserve SVG conventions
- preserve pullquote conventions
- preserve animation conventions

Do not introduce new visual systems unless explicitly requested.

Prefer existing project patterns over creating new ones.

---

## Editorial Boundaries

The manuscript is considered approved source material.

Do not:

- rewrite manuscript content
- alter wording
- modify arguments
- modify philosophy
- change meaning
- shorten text
- expand text

Only make editorial changes when explicitly instructed.

Editorial responsibility belongs outside Claude Code.

Implementation responsibility belongs inside Claude Code.

---

## Manuscript Processing

When MANUSCRIPT.md is updated:

- identify new chapters
- identify modified chapters
- identify page breaks
- identify pullquotes
- identify chapter illustrations
- identify SVGs
- identify animations
- identify referenced assets
- identify structural changes

Then determine which website files require updating.

Your responsibility is implementation, not authorship.

---

## Assets

MANUSCRIPT.md may reference:

- WebP illustrations
- chapter plates
- SVG diagrams
- SVG animations
- pullquotes
- ornamental separators
- supporting graphics

Assume referenced assets have already been created and approved.

Your responsibility is to correctly integrate those assets into the book.

Do not redesign approved assets unless explicitly requested.

---

## Chapter / page editing conventions

**`book.json`'s `order` array is the single source of truth for the book's sequence.** Each slug in it is a filename in `/pages` minus `.html`. Pages are named for *what they say*, never for where they sit, so nothing is ever renumbered when the book is reordered.

| You want to… | You do… |
|---|---|
| Insert a page anywhere | Drop its slug into `order` at that spot. Nothing else changes. |
| Reorder | Move slugs around in `order`. |
| Pull a page but keep the file | Move its slug from `order` into `drafts`. |
| Delete a page | Remove the slug from `order`/`drafts`, delete the file. |
| Rename a page's subject | Rename the file *and* its slug in `order`. |

Page numbers, folio numerals, the "N of total" count, and the reader's saved reading position are all derived from `order` at load time — never hand-typed. Every page counts straight through, 1, 2, 3…, title page and contents included; there's no separate roman-numeral front matter.

**Pages come in facing pairs on desktop** (even index = left page, odd index = right page). Inserting one page shifts every later page to the opposite side of the spread — never design a page assuming a specific neighbour, and never build content that depends on being seen alongside the page before/after it.

After editing `book.json` or any page file, validate before committing:

```bash
python3 tools/check.py
```

This catches: a slug in `order`/`drafts` with no matching file, a page file nobody lists (invisible), a slug listed twice, a slug in both `order` and `drafts`, a missing image or partial reference, leftover `${...}` template syntax, and a missing `.page-inner` wrapper. There is no other automated check in this repo — this script is it.

---

## Deployment workflow

No build step. Deployment is GitHub Pages via `.github/workflows/static.yml`, triggered on push to `main`, which uploads the repo root as-is. Because GitHub Pages serves over real HTTP, the site works there with zero special handling.

**Local development** requires an actual HTTP server, because pages are fetched at runtime with `fetch()` and browsers block `fetch` over `file://`. Double-clicking `index.html` shows a "the book must be served" notice instead of the book — that's expected, not a bug.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Before pushing: run `python3 tools/check.py` to catch broken references, then verify in an actual browser — page turning, the jump-to-page numpad, folio numbering, and (at a narrow viewport) the mobile scroll mode, since none of that is covered by an automated test.

---

## HTML structure

`index.html` is a ~4 KB shell — `<head>`, the book's DOM skeleton, nothing else. It knows nothing about page content or order.

Each file in `/pages` is an HTML **fragment**, not a document:

```html
<!-- entry-03-mirror-principle-opening
     Entry III, opening: the mirror as instrument -->
<div class="page-inner" style="position:static">
  <p class="running-head">The Reality Manual</p>
  <p class="entry-no">Entry the Third</p>
  <h2 class="entry-title">The Mirror<br>Principle</h2>
  <p class="ornament">✦ ✦ ✦</p>
  <div class="body-text">
    <p class="dropcap">Every judgment describes the judge before the judged…</p>
  </div>
  <span class="folio" data-num="arabic"></span>
</div>
```

Rules that make this load correctly:

- **No `<html>`, `<head>`, or `<body>` tags** — it's inlined into the running book, not rendered standalone.
- **Exactly one `.page-inner` wrapper per file**, with `style="position:static"`.
- **Exactly one `<span class="folio" data-num="arabic"></span>`**, empty, as the last element. `loader.js` fills in the actual numeral based on the page's position in `order` — never type a numeral by hand.
- **The leading HTML comment is a note to editors, not markup** — `loader.js` strips it before the fragment reaches the DOM.
- **Shared markup** (e.g. the sigil) lives under `assets/` and is pulled in with `{{> svg/sigil.svg }}`, which `loader.js` inlines literally into the page HTML. Use a partial (not `<img>`) for anything the stylesheet needs to animate — CSS can't reach inside an externally-referenced `<img src="....svg">`. Use plain `<img>` for static raster plates.

CSS loads in a fixed order from `index.html`, split by *concern* rather than by breakpoint: `tokens.css` → `base.css` → `book.css` → `typography.css` → `components.css` → `animations.css` → `page-turn.css` → `ui.css` → `pages.css` → `responsive.css` (always last, since mobile replaces the 3D book with a scrollable stack rather than resizing it).

---

## Preserving book functionality

The load pipeline (`js/loader.js` → `js/book.js` → `js/main.js`) depends on strict conventions holding across every page file. Breaking any of these produces a blank page or a silent layout failure rather than a loud error:

1. **Never hand-type a page number, hex colour, or font-family/size in `px`/`rem`/`em` on a page.** Numbers come from `book.json`'s order; colours and sizes come from tokens and classes in `css/tokens.css` / `css/typography.css`. Hard-typed values silently drift out of sync on the next reorder or font change. **This includes margin/padding**, not just font-size: a bare `em` on any element without its own `calc(var(--page-w) * n)` font-size (e.g. a plate — it sits as a sibling of `.body-text`, not inside it, so it has no page-relative font-size to inherit) resolves against the browser's fixed default instead, and looks fine at whatever size you tested it at while silently drifting on every other device. This exact bug shipped once already (`.plate-img`'s own book-wide default margin, `css/typography.css`) before being caught — see `docs/DESIGN-CONVENTIONS.md` §3 and §12.3 for the full story.
2. **Never let a page overrun.** `.page-inner` is `overflow:hidden` — content past the bottom edge is not scrolled or warned about, it's simply invisible. This is the one way to actually break the book, and it fails silently, so word budgets must be respected.
3. **Never invent a class**, and never restyle an existing one to suit a single page — an unstyled class renders as naked text; one-off rules belong in `css/pages.css`.
4. **Keep exactly one `.page-inner`, one empty `.folio`, one dropcap per entry, one ornament per page, one marginal per page, one pull quote per page.** The renderer and stylesheet assume these cardinalities.
5. **Animate SVG only, never text or layout**, and keep motion slow/ambient/looping — nothing reacts to scroll, hover, or click. `prefers-reduced-motion` disables all SVG animation and the page-turn itself, so a plate must still read correctly as a fully static image.
6. **Reader position is keyed by page slug**, not content hash — so editing a page's text is safe, but renaming a slug without updating `book.json` (or vice versa) will silently reset or break position memory.
7. **Run `python3 tools/check.py` after any change to `book.json` or `/pages`** before pushing — it's the only safety net for the invariants above (missing files, missing partials, missing `.page-inner`, duplicate/orphaned slugs, stray template syntax).
8. **If a CSS value depends on context (what's before/after a plate, whether a caption follows), derive it from the actual markup — don't create a modifier class an author has to remember to add or remove.** A class that must be manually kept in sync with a page's content will eventually fall out of sync on some page, and the book reads as inconsistent even though no single rule was "broken." This shipped for real once: `.plate-frame`'s margin was a `-loose` modifier class that had to be re-applied by hand whenever a caption was added/removed, and it drifted on a live page. Fixed by deriving the margin with `:has(+ .plate-caption)` instead — see `docs/DESIGN-CONVENTIONS.md` §0 for the full principle.

---

## Website Development

You are responsible for helping maintain and improve the Reality Manual website.

You may:

- create pages
- modify pages
- update HTML
- update CSS
- update JavaScript
- update book.json
- update navigation
- update chapter metadata
- update page references
- update supporting files
- create new implementation files

When implementing changes:

- identify all affected files
- update all affected files
- preserve existing architecture
- preserve repository consistency

Do not leave the repository in a partially updated state.

---

## Production Responsibilities

The intended workflow is:

1. MANUSCRIPT.md is updated.
2. Images, SVGs, and animations are created and approved.
3. Assets are uploaded to the repository.
4. Website pages are updated to reflect the manuscript.
5. Navigation and supporting files are updated.
6. Changes are committed.
7. Changes are pushed.
8. Deployment occurs automatically.

Optimize for this workflow.

---

## Commit And Push Behavior

For routine implementation work:

- make requested changes
- update all affected files
- verify consistency
- run validation checks
- commit changes
- push changes

Deployment is expected unless a request is ambiguous, destructive, or unclear.

In those cases, ask for clarification first.

---

## Project Awareness

Always attempt to understand the repository before making changes.

When modifying a feature:

- identify all related files
- update all affected files
- preserve existing architecture
- avoid introducing unnecessary complexity

Do not make isolated changes that break repository consistency.

---

## General Principle

The manuscript is the product.

The website is the presentation layer.

Your responsibility is to faithfully transform the manuscript into a polished reading experience while preserving consistency across the entire Reality Manual project.

When in doubt:

1. Follow MANUSCRIPT.md.
2. Follow existing chapters.
3. Follow existing project patterns.
4. Preserve consistency.
5. Ask before making major or destructive changes.

Deployment is GitHub Pages on push to `main` (see Deployment workflow above) — ask before proceeding with major or destructive changes; otherwise, for routine implementation work, assume deployment is the desired end state and no extra confirmation is needed to push.