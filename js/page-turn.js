/* ==========================================================
   PAGE TURN — the single leaf, and the flutter for longer jumps
   Styling lives in css/page-turn.css.
   ========================================================== */

import { el, state, isMobile, reduced, fillSlot, settleFromLeaf, render, updateStacks } from './book.js?v=1';

const TURN_MS = 900;   /* keep in step with --turn-ms in css/tokens.css */

/* Shared by the normal turn-completion timeout and finishTurnNow() (fired
   when a new click cuts an in-flight turn short) — both need to land the
   spread the same way, settleFromLeaf and all, or a rapid-clicked turn
   would restart an animation that a leisurely one wouldn't. */
function land(dir, next){
  el.leaf.classList.remove('turning','back');
  el.shade.classList.remove('on');
  if (dir > 0) settleFromLeaf('pageL', 'leafBack');
  else settleFromLeaf('pageR', 'leafFront');
  state.spread = next;
  render();
  state.turning = false;
}

export function finishTurnNow(){
  if (!state.turning) return;
  clearTimeout(state.turnTimeout);
  land(state.turningDir, state.inFlightNext);
}

export function go(dir, ms, done){
  if (isMobile()) return;
  if (state.turning) finishTurnNow(); /* don't wait it out — snap it to its
    destination instantly and proceed, so state always tracks clicks
    in real time rather than being gated by animation length */
  ms = ms || TURN_MS;

  const next = state.spread + dir;
  if (next < 0 || next > state.maxSpread) return;

  if (reduced){
    state.spread = next; render();
    if (done) done();
    return;
  }

  state.turning = true;
  state.inFlightNext = next;
  state.turningDir = dir;
  el.leaf.style.animationDuration = ms + 'ms';
  el.shade.style.animationDuration = ms + 'ms';

  const p = state.pages;
  if (dir > 0){
    /* leaf front = current right page, leaf back = next left page */
    fillSlot('leafFront', p[state.spread*2+1]);
    fillSlot('leafBack', p[next*2]);
    /* underneath: left stays, right becomes the next right page */
    fillSlot('pageR', p[next*2+1]);
    el.leaf.classList.remove('back');
  } else {
    /* turning back: leaf starts flat on the left (rotated -180) and returns.
       front = previous right page, back = current left page */
    fillSlot('leafFront', p[next*2+1]);
    fillSlot('leafBack', p[state.spread*2]);
    fillSlot('pageL', p[next*2]);
    el.leaf.classList.add('back');
  }

  el.leaf.classList.remove('turning');
  el.shade.classList.remove('on');
  void el.leaf.offsetWidth; /* force a reflow so a class that was just removed
    (e.g. by finishTurnNow() firing in the same tick) is registered as gone
    before we re-add it — otherwise the browser never sees a real toggle
    and the CSS animation doesn't restart, it just snaps to its end state */

  el.leaf.classList.add('turning');
  el.shade.classList.add('on');

  state.turnTimeout = setTimeout(()=>{
    land(dir, next);
    if (done) done();
  }, ms + 20);
}

/* every click acts immediately — no queue. If a turn is already mid-flight,
   go() itself snaps it to completion first, so the new request always
   starts right away rather than waiting for the previous animation to
   run its full course. */
export function requestGo(dir){
  if (isMobile()) return;
  go(dir);
}

/* flutter: for jumps of 2+ spreads, a cascade of leaves takes flight together —
   staggered starts, varied speeds, the last leaf slowest so the book settles.
   Only the first leaf carries away real content and only the last lands with
   real content; the sheets between are blank parchment, as they'd be in a blur. */
export function flutterTo(target, done){
  if (state.turning || target === state.spread) return;
  const steps = Math.abs(target - state.spread);
  const dir = target > state.spread ? 1 : -1;
  if (steps === 1){ go(dir, undefined, done); return; }
  if (reduced){ state.spread = target; render(); if (done) done(); return; }

  state.turning = true;
  const K = Math.max(4, Math.min(steps, 7)); /* leaves in flight */
  const delayStep = 100;
  const box = document.createElement('div');
  box.className = 'flits';
  let lastEnd = 0;

  for (let i = 0; i < K; i++){
    const last = (i === K - 1);
    const dur = last ? 820 : 500 + (i % 3) * 65;  /* varied wingbeats, slow settle */
    const delay = i * delayStep;
    lastEnd = Math.max(lastEnd, delay + dur);
    const node = document.createElement('div');
    node.className = 'flit' + (dir < 0 ? ' rev' : '');
    node.style.animationDelay = delay + 'ms';
    node.style.animationDuration = dur + 'ms';
    /* real fluttering pages are never perfectly aligned */
    node.style.top = ((i % 3) * 2) + 'px';
    node.style.bottom = (((i + 1) % 3) * 2) + 'px';
    node.innerHTML =
      '<div class="leaf-face front"><div class="parchment"></div><div class="page-inner" id="flitF'+i+'"></div></div>' +
      '<div class="leaf-face back"><div class="parchment"></div><div class="page-inner" id="flitB'+i+'"></div></div>';
    box.appendChild(node);
  }
  /* the gutter rides above the flutter, constant throughout */
  const spineTop = document.createElement('div');
  spineTop.className = 'spine flit-spine';
  box.appendChild(spineTop);
  document.querySelector('.pages-wrap').appendChild(box);

  const p = state.pages;
  if (dir > 0){
    fillSlot('flitF0', p[state.spread*2+1]);        /* first leaf lifts the current right page */
    fillSlot('flitB'+(K-1), p[target*2]);           /* last leaf lands as the target left page */
    fillSlot('pageR', p[target*2+1]);               /* waiting underneath the flutter */
  } else {
    fillSlot('flitB0', p[state.spread*2]);          /* first leaf lifts the current left page */
    fillSlot('flitF'+(K-1), p[target*2+1]);         /* last leaf lands as the target right page */
    fillSlot('pageL', p[target*2]);
  }

  /* the gilt blocks drift to their destination while the leaves fly */
  updateStacks(state.maxSpread > 0 ? target / state.maxSpread : 0);
  el.shade.style.animationDuration = lastEnd + 'ms';
  el.shade.classList.add('on');

  setTimeout(()=>{
    el.shade.classList.remove('on');
    box.remove();
    state.spread = target;
    render();
    state.turning = false;
    if (done) done();
  }, lastEnd + 60);
}
