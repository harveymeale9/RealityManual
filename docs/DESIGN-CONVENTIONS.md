# The Reality Manual — Design Conventions

Paste this with any request to write new pages, alongside `page-template.html`,
your text, your images, and notes on arrangement.

**This document is deliberately dense.** It gets pasted every time, so every line
earns its place. It describes *choices* — which class, when, why. It does not
restate CSS values, because those live in `css/` and a copy here would rot.
Where a number appears below, it's one you can't get by reading a stylesheet.

---

## 0. The two rules

**A page is a fixed box that clips. It does not scroll.**

`.page-inner` is `overflow:hidden`. Text past the bottom edge is not shortened,
not scrolled, not warned about — it is *silently invisible*. Overrunning a page
is the only way to actually break this book, and it fails quietly.

So: **count the words before writing, not after.**

**If a value depends on context, derive it — don't ask an author to remember it.**
A modifier class that must be manually added whenever a page's surrounding
content changes (a caption removed, text added around a plate) *will* eventually
be forgotten on some page, and the book will read as internally inconsistent —
not because a rule was broken, but because nobody was reminded to apply it. This
already happened once for real: `.plate-frame`'s margin used to be a `-loose`
class you had to remember to add whenever a plate lost its caption, and one page
kept the tight spacing after its caption was removed, reading as an unexplained
inconsistency next to every other plate in the book. Prefer CSS that derives its
own state from the actual markup — `:has()`, sibling selectors — over a class
whose correctness depends on someone remembering to toggle it. If you catch
yourself writing "add class X whenever condition Y," ask whether the CSS can just
check for Y directly instead.

## 1. How much fits (measured, not estimated)

| Page shape | Fits | Aim for |
|---|---|---|
| Body text, running head only | ~990 chars / ~165 words | **150 words** |
| Entry opening (no. + title + ornament + text) | ~771 chars / ~128 words | **115 words** |
| Text + a full-width plate | varies with plate height | **measure it** |
| Add a `.marginal` | subtract ~45 words | |
| Add a roughly square plate | subtract ~50 words | |
| Add an `.ornament` | subtract ~12 words | |

These hold at **every screen size**. Nothing above is a desktop-only number.

Aim ~10% under. A page that fills to the last pixel has no room for a fix later,
and the fonts load asynchronously — if they arrive slightly wider than fallback,
a full page silently loses its last line.

Prose runs long before it runs short. When an idea doesn't fit, **split it across
two pages** — this is a compendium, pages are cheap. Never shrink the type.

## 2. Colour and mood

A candlelit desk at night; a medieval manuscript, rubricated by hand. Warm,
low-key, aged. Nothing in it is pure black or pure white, ever.

| Token | Hex | Is for |
|---|---|---|
| `--ink` | `#2b2116` | body text. The default. |
| `--ink-faint` | `#5d4c35` | anything secondary: running heads, folios, captions, marginalia, definitions |
| `--rubric` | `#7a2f1d` | oxblood. **Structural** emphasis only — see below |
| `--brass` | `#9c7c3c` | gold. **Ornament** only — rules, flourishes, dividers, numerals |
| `--paper` / `--paper-deep` | `#e9dcbd` / `#d9c79f` | the leaf. Never set as a text colour. |
| `--desk` / `--desk-dark` / `--leather` | — | the world outside the book. Never used on a page. |

**Rubric vs brass is the one distinction to get right.** In a real grimoire, red
ink marked *structure* — where a thing begins, what rank it holds. Gold was
*decoration*. So:

- **Rubric** = entry numbers, dropcaps, law numerals, `.xref`, table headers,
  glyphs, the seal. Things that say *what this is*.
- **Brass** = ornaments, rules, step numerals, frames. Things that say *nothing*.

Rubric is not a highlighter. It never emphasises a word mid-sentence for
emphasis's sake — use `.xref` if the word is a genuine cross-reference, or italics
if you just mean stress.

**Never write a hex value into a page.** Use the tokens.

## 3. Typography

Three faces, each with one job. Never mix them up.

| Face | Job | Where |
|---|---|---|
| **IM Fell English SC** (small caps) | authority, structure | running heads, entry numbers, entry titles, dropcaps, law names, table headers |
| **IM Fell English** | the voice | `.body-text` — all continuous prose |
| **Cormorant Garamond** *(italic)* | the aside | marginalia, captions, folios, pull quotes, lexicon definitions, step numerals |

(A fourth, **Caveat**, exists for exactly one thing: hand-chalked lettering inside
the lecturer's-slate SVG. Don't reach for it.)

The hierarchy, largest to smallest — as multiples of `--page-w`:

```
.07   title-page h1, seal glyph      the only display sizes
.05   .pullquote                     a page's loudest voice
.046  h2.entry-title
.034  .body-text                     ← the baseline everything reads against
.0305 .toc
.0295 .laws, .steps
.026  .ornament
.0255 .marginal
.0235 .plate-caption
.0175 .entry-no, .pullquote-attr
.0165 .running-head
```

**Type scales with the page, not the screen.** That is the entire responsive
strategy — see §9. Never write `font-size` in `px`, `rem`, or `em` on a page.
If you need a size that isn't listed, you almost certainly need an existing class.

**The same rule applies to margin and padding, and it's easier to get wrong.**
`em` is only page-relative if the SAME element (or a close ancestor in the same
context) already has its own `calc(var(--page-w) * n)` font-size — most classes
do, so most existing `em` margins in this codebase are already safe. But a plate,
a plate wrapper, or anything else that sits as a bare sibling of `.body-text`
rather than inside it has NO font-size of its own; a bare `em` margin on it
silently falls back to the browser's ambient default font-size — a fixed pixel
value that does not track the page at all. It looks identical to a correct value
at whatever page-w you happened to test it at, and only reveals itself as wrong
on a different device or window size, which is what makes it easy to reintroduce
(this happened for real: `.plate-img`'s own book-wide default margin used bare
`em` for a long time before being caught and fixed). When in doubt, ask: "does
this exact element have a `calc(var(--page-w) * n)` font-size declared on it?" —
if not, its margin/padding needs `calc(var(--page-w) * n)` too, never a bare unit.

Body text is `justify` + `hyphens:auto`, `line-height:1.62`. Paragraphs after the
first get a 1.6em indent automatically (`p + p`) — **do not add blank lines or
`<br>` between paragraphs**; just write consecutive `<p>` tags.

## 4. The measure

`.page-inner` is `padding: 9% 11% 3%` with `bottom: 7%` reserved for the page
indicator. Percentages of the page, so the margins scale too.

That gives a text column of **78% of page width**, roughly **50–58 characters** —
a proper book measure. This is why the type looks right; don't fight it. Never
override the padding on a page.

The bottom 7% strip belongs to the "x of xx" indicator. Content is clipped above
it, so nothing you write can collide with it. Don't try to use that space.

## 5. The vocabulary

Everything a page may contain. If you want something not on this list, say so
rather than inventing a class — an unstyled class renders as naked text.

**Structure**
- `.running-head` — the small caps line at the top. Almost every page has one.
  Alternates: `The Reality Manual` on verso-ish pages, `Entry II · Well-Being` on
  the others. Follow the neighbours.
- `.entry-no` — `Entry the Third`. Openings only.
- `h2.entry-title` — the entry's name. Openings only. `<br>` to balance the lines.
- `.folio` — **always** `<span class="folio" data-num="arabic"></span>`, empty.
  Never type a numeral. Every page counts straight through — 1, 2, 3… — title
  page and contents included; there's no separate front-matter numbering.
  One per page, last thing.

**Prose**
- `.body-text` — wraps all prose. Contains `<p>`s.
- `.dropcap` — on the **first `<p>` of an entry only**. Never twice on a page,
  never mid-entry. It's the flourish that says "a thing begins here."
- `.marginal` — the aside. Rubric-bordered, italic. See §8.
- `.xref` — inline small caps for a genuine cross-reference:
  `<span class="xref">See also: Entry V.</span>`

**Forms** (see `components.css`)
- `.toc` (with `.t` / `.dots` / `.n` / `.sealed-mark`)
- `.laws` — auto-numbered roman, hanging indent. `<li><span class="law-name">Name.</span> Text</li>`
- `.steps` — auto-numbered brass numerals
- `.grim-table` — table of correspondences
- `.lexicon` — two-column `<dl>`
- `.pullquote` + `.pullquote-attr` — see §7
- `.rule-orn` — a brass rule with centred content
- `.sealed` / `.veiled` — the paywall page
- `.title-page` — centred layout for openers/colophons

**Never invent a class.** Never add inline `style` beyond what §6 permits.

## 6. Ornaments

Three glyphs, and they mean different things:

- `❦` — a full stop. Ends a page or a thought. Most common.
- `✦ ✦ ✦` — a section break under an entry title.
- `✦` — a lighter beat.

`<p class="ornament">❦</p>`. Brass, centred, generously letterspaced.

**At most one per page.** Two ornaments on a page is a page that hasn't decided
what it's saying. An ornament is punctuation, not decoration — if the page doesn't
need a pause, it doesn't get one.

The only permitted inline styles on a page are layout nudges of this kind, which
already appear in existing pages and are fine to reuse:

```html
style="text-align:center; font-style:italic; text-indent:0; margin:1em 0;"
style="text-indent:0;"     /* kills the auto-indent on a p that follows another */
style="width:64%"          /* on a plate — ONLY to make it NARROWER than the
                              default full measure. Rare. Have a reason. */
```

Nothing else. No colours, no font sizes, no padding.

## 7. Pull quotes

```html
<p class="pullquote"><span class="q-mark">“</span>The map is a rumour;<br>the territory is a visit.</p>
<p class="pullquote-attr">Entry IV · Maps Are Not Territory</p>
```

A pull quote is the page's loudest element at `.05` — nearly as large as an entry
title. So: **one per page, and it earns the page.** A page with a pull quote plus
150 words of body text is a page shouting over itself. Give it room. `<br>` to
break the line where the sense breaks, not where it happens to wrap.

## 8. Footnotes — there aren't any

**There is no footnote component, by design.** A footnote wants a page that
scrolls and a foot that's free; this book has neither (the foot is the indicator
strip, §4).

The book's equivalent is **`.marginal`** — the marginal gloss, which is what a
manuscript would actually have used:

```html
<p class="marginal">Heaven has no address; yours need not resemble mine.</p>
```

Italic Cormorant, `--ink-faint`, with a rubric rule down its left edge. Use it for
the aside, the caveat, the second thought.

Rules: **one per page.** It goes *after* the `.body-text` block it comments on,
not inside it. Keep it under ~25 words — it's a whisper. And it costs ~45 words of
body text, so budget it before writing the prose.

If you genuinely need numbered references, ask and I'll add a proper form — don't
improvise one with `<sup>`.

## 9. Illustrations and captions

Two kinds, and picking wrong is a real error:

**Plates fill the measure.** Don't write a width — full-column is the default, for
raster and vector alike. A width only ever makes a plate *narrower*, in `%`, never
`px`. A full-width plate is roughly 1.5× the height of the old 64% one: budget it.

**Raster plates** — painted/photographic. `assets/images/*.webp`. The default,
arrived at over several rejected attempts (a spotlight, a shimmer band, sparkle
glints): wrap the `<img>` in a `.plate-frame`. That's what actually carries the
look — a soft torn edge, a corners-only misty fade, a warm glow, a slow float, a
darkening vignette, a flickering candlelight wash — automatically, no other
classes to remember:
```html
<div class="plate-frame">
  <img class="plate-img" src="assets/images/entry-03-plate-1.webp"
       alt="Describe what is drawn, fully — this is read aloud.">
</div>
<p class="plate-caption">What it shows, stated plainly.</p>
```
Narrow it the usual way — `style="width:64%"` on the `.plate-frame`, not the
`<img>`. Its margin (tight before a caption, more room when body text follows
instead) is **derived automatically** from whether a `.plate-caption` actually
follows in the markup (`.plate-frame:has(+ .plate-caption)`) — there used to be a
`.plate-frame-loose` modifier class for this and it's gone now, precisely because
it had to be remembered and re-applied by hand every time a page's caption was
added or removed, and it drifted on a real page as a result. Nothing to choose
here any more: add or remove a `.plate-caption`, the spacing follows on its own.

A bare `<img class="plate-img">` with **no** `.plate-frame` wrapper still exists —
flat, `mix-blend-mode:multiply`, printed straight into the parchment, no torn
edge or glow. That's the exception now, not the default: reach for it only when a
page deliberately wants the plain look (the chapter-opening plate's own full-bleed
`.chapter-bleed` is one, and predates this convention besides), not out of habit.
**Export on white** either way — multiply needs it.

**Vector plates** — line art. `assets/svg/*.svg`, pulled in with `{{> svg/sigil.svg }}`.
Use a partial (not `<img>`) whenever the art animates: our CSS drives the sigil's
innards, and CSS cannot reach inside an `<img src="...svg">`.

**Placement.** A plate goes *after* the prose that earns it, or alone on its own
leaf. Never open a page with a plate above its running head. Full-page plates are
a real option and often the better one — see the aperture and chart pages.

**Captions.** `.plate-caption`, italic Cormorant, `--ink-faint`, centred.
**Never use the word "Plate" in a caption.** Just describe what the image above it
is — a plain statement, not a label:

> The aperture turns; the centre holds.
> One life, taken second by second across the years.

Present tense, no full stop unless it's two clauses. `alt` carries the literal,
exhaustive description (read aloud); the caption is shorter and reads at a glance.
Never "Figure 1" or "Diagram of X". If a plate doesn't need one to make sense on
the page, skip the caption entirely rather than forcing one.

The caption sits at **70% of the measure**, centred — deliberately narrower than
the plate above it, so it reads as a whisper beneath the image rather than a second
column of text. It wraps to two lines more readily than it used to; that's fine,
and it's another line off the budget.

## 9.5 SVG Cropping & Whitespace

**SVG assets must not contain significant internal padding or invisible margins.**

The SVG `viewBox` should be cropped tightly to the outermost geometry so that the
asset contains artwork, not layout decisions. Whitespace belongs to the page
composition, not to the illustration itself.

Consequences:

- Sigils, ornaments, diagrams, charts, glyphs, and line-art plates should be
  exported with a tightly cropped `viewBox`.
- Internal whitespace should be kept to the absolute minimum required to avoid
  clipping strokes.
- Page breathing room is created by the book layout, margins, captions, and
  surrounding content, never by invisible space embedded inside an SVG.
- If an illustration appears too small or too large on the page, adjust its
  placement or width in the layout. Do not solve the problem by re-exporting an
  SVG with extra empty space around it.
 - Never use whitespace inside an SVG to centre or position artwork on the page.
  Positioning is the responsibility of the page layout, not the asset.

**Exception:** full-page compositions in which the whitespace is itself part of
the artwork may intentionally retain internal space. This should be rare and
deliberate.

When generating new SVG assets, assume **zero internal margin** unless explicitly
instructed otherwise.

A useful test:

> If the SVG were placed against a coloured background with a visible bounding
> box, the artwork should appear to nearly fill that box.

In other words:

```text
Asset = artwork
Layout = whitespace
```

Never:

```text
Asset = artwork + mystery whitespace
Layout = more whitespace
```

The book controls spacing. The SVG supplies the art.

## 10. Animation

Motion is ambient and eternal — it loops forever, slowly, and never reacts to the
reader. Nothing on a page animates on scroll, hover, or click. The book breathes;
it doesn't perform.

Available (`animations.css`): `.orbit-slow|mid|fast` (11–44s), `.twinkle` (+`.t2`
`.t3` to stagger), `.inscribe` (+`.d2`–`.d5`, self-drawing strokes), `.chalk-write`
(+`.c1` `.c2` `.c4`), `.breathe`, `.moon-shadow`, `.sigil-rotate` (+`.rev`),
`.sigil-pulse`.

Rules: **animate SVG only**, never text or layout. Durations stay slow — 5s is
fast here, 60s is normal. Stagger with the delay classes so nothing pulses in
unison. Anything new goes in `animations.css`, never inline.

`prefers-reduced-motion` kills all SVG animation and the page-turn wholesale — so
**a plate must still read as a static image.** If the meaning only appears once it
moves, it's broken for a reader who's turned motion off.

## 11. Mobile

**You do not write a mobile version of a page.** There is one fragment and it
renders everywhere. This is the payoff of §3: because every size is
`calc(var(--page-w) * n)`, and `responsive.css` redefines `--page-w` on a phone,
the entire page scales as one — the same measure, the same proportions, the same
word count.

`--page-w` names the *page*, not the leaf you can see. On a phone the two
diverge: the leaf spends its side margin to buy type size. In page units it is
the same page as desktop — same measure, same budget. That divergence is
`responsive.css`'s business, never a page's.

What actually changes on mobile is the *book*, not the page: the 3D spread is
replaced by a vertical scroll of single leaves. That's `responsive.css`'s business,
not yours.

Consequences worth knowing:
- **Desktop is the binding constraint.** Mobile leaves are proportionally taller,
  so slightly *more* fits — a few percent, not a licence. If it fits on desktop,
  it fits.
- **Pages stop being pairs.** Facing-page compositions read as two consecutive
  leaves. Nothing may depend on being seen alongside its neighbour.
- `.lexicon` keeps two columns at 520px. It's tight. Prefer it on shorter lists.

## 12. What must never change

1. **Never type a page number, or refer to one.** Not in prose, not in a folio,
   not in a TOC, not in a cross-reference. Refer to entries by name. Numbers are
   derived from `book.json`, and anything hard-typed becomes a lie on the next
   insert.
2. **Never overrun the page.** §1. It fails silently.
3. **Never use `px` for type or plate widths — or a bare `em`/`px` for margin or
   padding on anything that lacks its own `calc(var(--page-w) * n)` font-size.**
   Both break the scaling in §11, and the margin version is the sneakier of the
   two: it renders fine at whatever size you tested, then drifts on every other
   device. See §3's own note on this.
4. **Never write a hex colour or a font family on a page.** Tokens and classes.
5. **Never invent a class**, and never restyle an existing one to suit one page —
   that's what `css/pages.css` is for.
6. **Never use pure black, pure white, or any colour outside the palette.**
7. **One `.page-inner` per file**, with `style="position:static"`. Exactly one
   `.folio`, empty, last. No `<html>`, `<head>`, or `<body>`.
8. **Never nest `.body-text`** or put a plate inside it — **except** a floated
   plate (`.plate-frame-float`/`-right`), which MUST go inside `.body-text` (as
   its first child) or it won't float at all: `.page-inner` is `display:flex`
   (column), and float has no effect on a flex item, so a float placed as
   `.body-text`'s sibling just becomes an inert second flex item — floating
   only works once it shares an ordinary block context with the text it wraps.
   A plain (non-floated) plate stays outside `.body-text` as before.
9. **One dropcap per entry, one ornament per page, one marginal per page, one
   pull quote per page.**
10. **Never animate text.** SVG only.
11. **Never assume a page's neighbour.** It moves.
