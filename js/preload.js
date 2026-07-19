/* ==========================================================
   PRELOAD — warms the browser's image cache for pages just outside
   the visible spread, so turning forward or back never reveals a
   plate that's still fetching. Page HTML itself is already fetched
   for the whole book up front (loader.js); what's NOT fetched until
   an <img> actually lands in the DOM is the image it points at —
   fillSlot() only inserts the current spread (plus, briefly, the
   leaf mid-turn), so a page two turns away has never had its images
   requested at all until the reader gets there.
   ========================================================== */

const IMG_SRC_RE = /<img\b[^>]*\bsrc="([^"]+)"/g;

/* module-level, not per-call: once an asset's been asked for, asking
   again is just a wasted regex match, not a wasted network request
   (the browser's own HTTP cache already dedupes that part) — but
   skipping the redundant new Image() churn is free to do. */
const requested = new Set();

function preloadPage(page){
  if (!page) return;
  for (const m of page.html.matchAll(IMG_SRC_RE)){
    const src = m[1];
    if (requested.has(src)) continue;
    requested.add(src);
    const img = new Image();
    img.src = src;
  }
}

/* Warms the current spread's own two pages plus two pages of run-in on
   EACH side — five spreads' worth of plates sitting ready by the time
   a reader who flips twice in a row actually arrives. Called from
   book.js's render() on every settle (initial load, each turn, each
   jump), so the window continuously slides with the reader rather than
   only ever covering where the book was first opened. */
export function preloadAround(pages, spread){
  const left = spread * 2;
  const from = Math.max(0, left - 2);
  const to = Math.min(pages.length - 1, left + 1 + 2);
  for (let i = from; i <= to; i++) preloadPage(pages[i]);
}
