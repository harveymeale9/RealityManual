/* ==========================================================
   BOOK — shared state, the DOM slots, rendering, position memory
   The page-turn and jump modules both read and drive this.
   ========================================================== */

export const el = {};
export function cacheDom(){
  ['pageL','pageR','leaf','leafFront','leafBack','shade','stackL','stackR',
   'book','jumpInput','jumpTotal','scrollBook'].forEach(id => {
    el[id] = document.getElementById(id);
  });
}

/* One mutable object rather than a pile of exported `let`s: an imported
   binding can't be reassigned from another module, but its fields can. */
export const state = {
  pages: [],          // [{ slug, html }]
  spread: 0,          // spread n shows pages [2n, 2n+1]
  turning: false,
  turnTimeout: null,  // the pending setTimeout for the in-flight turn
  inFlightNext: null, // the spread that turn is heading to
  turningDir: 1,       // direction of the in-flight turn (1 or -1)
  maxSpread: 0,
};

export const isMobile = () =>
  window.matchMedia('(orientation: portrait) and (max-width: 940px), (max-width: 720px)').matches;
export const reduced =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- remember-my-place, keyed by SLUG ----------------------------------
   The filename is the page's permanent identity, so a reader's place
   survives any amount of reordering in book.json. If the page they were on
   is renamed or removed, we simply don't find it and open at the start. */
const LS_POS = 'reality-manual:last-page';

export function savePos(pageIndex){
  try{
    const p = state.pages[pageIndex];
    if (p) localStorage.setItem(LS_POS, p.slug);
  }catch(e){}   /* private mode / sandboxed preview: just don't remember */
}

export function savedPageIndex(){
  try{
    const slug = localStorage.getItem(LS_POS);
    return slug ? state.pages.findIndex(p => p.slug === slug) : -1;
  }catch(e){ return -1; }
}

/* the tome's thickness: shifts subtly toward the left as you read.
   Fills sit in fixed-width slots, so the pages themselves never move. */
export function updateStacks(frac){
  const max = isMobile() ? 15 : 30;
  const min = isMobile() ? 9  : 20;
  el.stackL.style.width = Math.round(min + frac * (max - min)) + 'px';
  el.stackR.style.width = Math.round(max - frac * (max - min)) + 'px';
}

/* pages are authored with their own .page-inner wrapper (which may carry
   layout classes like title-page or sealed); inject content AND classes.
   The folio is then lifted out of the clipped, padded page-inner and into
   its parent (.page), which is exactly the reserved 7% strip book.css sets
   aside for it — the folio was never meant to compete with body text for
   the page's clipped space.

   Skips the rebuild entirely if the slot already shows this exact page
   (tracked via data-slug): page-turn.js's go() pre-fills the slot that
   will be revealed UNDERNEATH the flipping leaf partway through the turn,
   so the turn never ends on a bare/stale page — but render() then runs
   again once the turn completes and, being a generic "make both slots
   match the current spread" function, would otherwise redraw that SAME
   slot a second time for no visual reason. innerHTML churn tears down and
   rebuilds every element inside, which restarts any CSS animation (an SVG
   plate, say) from frame zero — so a reader would see it play for an
   instant during the turn, snap back to the start the moment the leaf
   settles, then play through properly. Skipping a no-op refill fixes that
   at the source rather than special-casing it in page-turn.js. */
export function fillSlot(id, page){
  const node = el[id] || document.getElementById(id);
  const slug = page && page.slug;
  if (slug && node.dataset.slug === slug) return;
  node.dataset.slug = slug || '';
  const tmp = document.createElement('div');
  tmp.innerHTML = (page && page.html) || '';
  const w = tmp.firstElementChild;
  node.className = w ? w.className : 'page-inner';
  node.innerHTML = w ? w.innerHTML : '';
  /* the previous occupant of this slot left its folio behind in the parent
     (it was moved OUT of node, so clearing node.innerHTML above never
     touched it) — drop it before attaching this page's own folio, or they
     stack up across every turn/jump and overlap. Scoped to a DIRECT child of
     parentElement: a plain '.folio' query would also match THIS page's own
     folio, which at this point is still nested inside node (not yet lifted),
     and delete it before it's ever moved out. */
  const stale = node.parentElement && node.parentElement.querySelector(':scope > .folio');
  if (stale) stale.remove();
  const folio = node.querySelector('.folio');
  if (folio && node.parentElement) node.parentElement.appendChild(folio);
}

/* The other half of the animation-restart fix above. fillSlot()'s
   dataset-slug guard protects the slot that was pre-filled UNDERNEATH the
   flipping leaf — but the leaf itself has its OWN two faces (#leafFront /
   #leafBack), and whichever face is facing the reader when the turn ends
   is what the real slot has to end up showing. That face has been
   carrying a live, already-running animation for the whole turn; calling
   fillSlot() for the real slot at that point would still rebuild it from
   the page's HTML string — a DIFFERENT element than the one that was just
   animating — restarting the animation exactly as before, just on the
   other side of the spread. So instead of rebuilding, MOVE the leaf
   face's actual DOM nodes into the real slot: same elements, same
   in-flight animation, no restart. The leaf face is left empty and its
   data-slug cleared so a future fillSlot() call on it (next turn) doesn't
   mistake "empty" for "already showing that page" and skip its own fill. */
export function settleFromLeaf(id, leafFaceId){
  const node = el[id] || document.getElementById(id);
  const source = el[leafFaceId] || document.getElementById(leafFaceId);
  const sourceParent = source.parentElement;
  const stale = node.parentElement && node.parentElement.querySelector(':scope > .folio');
  if (stale) stale.remove();
  node.className = source.className;
  node.dataset.slug = source.dataset.slug || '';
  while (source.firstChild) node.appendChild(source.firstChild);
  /* the folio for this page was already lifted out of `source` into
     sourceParent (.leaf-face) back when fillSlot() first filled the leaf */
  const folio = sourceParent && sourceParent.querySelector(':scope > .folio');
  if (folio && node.parentElement) node.parentElement.appendChild(folio);
  source.className = 'page-inner';
  source.dataset.slug = '';
}

export function render(){
  if (isMobile()) return; /* portrait mode is the pre-built scroll stack */
  fillSlot('pageL', state.pages[state.spread*2]);
  fillSlot('pageR', state.pages[state.spread*2+1]);
  updateStacks(state.maxSpread > 0 ? state.spread / state.maxSpread : 0);
  if (document.activeElement !== el.jumpInput) el.jumpInput.value = state.spread*2 + 1;
  savePos(state.spread*2);   /* remember the (left) page of this spread */
}

/* build the scrollable page stack once; CSS decides when it's shown.
   Same lift as fillSlot above: each leaf's folio moves out of its
   .page-inner and onto the .page.m itself, into the reserved strip. */
export function buildScrollBook(){
  el.scrollBook.innerHTML = state.pages.map(p =>
    `<div class="page m" data-slug="${p.slug}"><div class="parchment"></div>${p.html}</div>`
  ).join('');
  el.scrollBook.querySelectorAll('.page.m').forEach(page=>{
    const folio = page.querySelector('.folio');
    if (folio) page.appendChild(folio);
  });
}
