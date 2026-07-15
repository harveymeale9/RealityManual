# The Reality Manual — Design Conventions

Paste this with any request to write new pages, alongside `page-template.html`,
your text, your images, and notes on arrangement.

**This document is deliberately dense.** It gets pasted every time, so every line
earns its place. It describes *choices* — which class, when, why. It does not
restate CSS values, because those live in `css/` and a copy here would rot.
Where a number appears below, it's one you can't get by reading a stylesheet.

---

## 0. The one rule

**A page is a fixed box that clips. It does not scroll.**

`.page-inner` is `overflow:hidden`. Text past the bottom edge is not shortened,
not scrolled, not warned about — it is *silently invisible*. Overrunning a page
is the only way to actually break this book, and it fails quietly.

So: **count the words before writing, not after.**

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
  Never type a numeral. `roman` for front/back matter. One per page, last thing.

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

**Raster plates** — painted/photographic. `assets/images/*.webp`.
```html
<img class="plate-img" src="assets/images/entry-03-plate-1.webp"
     alt="Describe what is drawn, fully — this is read aloud.">
<p class="plate-caption">Plate — What it shows, stated plainly.</p>
```
`.plate-img` is `mix-blend-mode:multiply` — it prints *into* the parchment instead
of pasting a white box onto it. **Export on white.**

**Vector plates** — line art. `assets/svg/*.svg`, pulled in with `{{> svg/sigil.svg }}`.
Use a partial (not `<img>`) whenever the art animates: our CSS drives the sigil's
innards, and CSS cannot reach inside an `<img src="...svg">`.

**Placement.** A plate goes *after* the prose that earns it, or alone on its own
leaf. Never open a page with a plate above its running head. Full-page plates are
a real option and often the better one — see the aperture and chart pages.

**Captions.** `.plate-caption`, italic Cormorant, `--ink-faint`, centred.
Convention is `Plate — ` then a statement, not a label:

> Plate — The aperture turns; the centre holds.
> Plate — One life, taken second by second across the years.

Present tense, no full stop unless it's two clauses. A caption says what the plate
*means*, never "Figure 1" or "Diagram of X". `alt` carries the literal description;
the caption carries the sense.

The caption sits at **70% of the measure**, centred — deliberately narrower than
the plate above it, so it reads as a whisper beneath the image rather than a second
column of text. It wraps to two lines more readily than it used to; that's fine,
and it's another line off the budget.

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
`calc(var(--page-w) * n)`, and `--page-w` becomes `min(94vw, 520px)` on a phone,
the entire page scales as one — the same measure, the same proportions, the same
word count.

What actually changes on mobile is the *book*, not the page: the 3D spread is
replaced by a vertical scroll of single leaves. That's `responsive.css`'s business,
not yours.

Consequences worth knowing:
- **Desktop is the binding constraint.** Mobile leaves are proportionally taller
  (1.36 vs 1.32), so slightly *more* fits. If it fits on desktop, it fits.
- **Pages stop being pairs.** Facing-page compositions read as two consecutive
  leaves. Nothing may depend on being seen alongside its neighbour.
- `.lexicon` keeps two columns at 520px. It's tight. Prefer it on shorter lists.

## 12. What must never change

1. **Never type a page number, or refer to one.** Not in prose, not in a folio,
   not in a TOC, not in a cross-reference. Refer to entries by name. Numbers are
   derived from `book.json`, and anything hard-typed becomes a lie on the next
   insert.
2. **Never overrun the page.** §1. It fails silently.
3. **Never use `px` for type or plate widths.** It breaks the scaling in §11.
4. **Never write a hex colour or a font family on a page.** Tokens and classes.
5. **Never invent a class**, and never restyle an existing one to suit one page —
   that's what `css/pages.css` is for.
6. **Never use pure black, pure white, or any colour outside the palette.**
7. **One `.page-inner` per file**, with `style="position:static"`. Exactly one
   `.folio`, empty, last. No `<html>`, `<head>`, or `<body>`.
8. **Never nest `.body-text`** or put a plate inside it.
9. **One dropcap per entry, one ornament per page, one marginal per page, one
   pull quote per page.**
10. **Never animate text.** SVG only.
11. **Never assume a page's neighbour.** It moves.
