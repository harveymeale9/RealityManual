/* ==========================================================
   JUMP — the page badge and its numpad
   The input is readonly and we type for it, so no native keyboard
   ever opens and the layout never shifts. Styling: css/ui.css.

   The badge itself stays invisible until opened (see .jump / .jump.open
   in ui.css) — the number a reader actually sees is the folio printed on
   each page. Tapping any folio is what opens this pad; see the click
   delegate below.
   ========================================================== */

import { el, state, isMobile, reduced, savePos } from './book.js?v=1';
import { flutterTo } from './page-turn.js?v=1';

let jumpBox, numpad;

export function syncMobilePage(){
  const els = document.querySelectorAll('#scrollBook .page.m');
  let best = 0, bestDist = Infinity;
  els.forEach((node, i)=>{
    const d = Math.abs(node.getBoundingClientRect().top - 40);
    if (d < bestDist){ bestDist = d; best = i; }
  });
  el.jumpInput.value = best + 1;
  savePos(best);   /* remember the page you've scrolled to */
}

export function jumpTo(){
  let p = parseInt(el.jumpInput.value, 10);
  if (isNaN(p)) return;
  p = Math.min(Math.max(p, 1), state.pages.length);
  el.jumpInput.value = p;
  el.jumpInput.blur();
  if (isMobile()){
    const node = document.querySelectorAll('#scrollBook .page.m')[p-1];
    if (node) node.scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block:'start'});
  } else {
    flutterTo(Math.floor((p-1)/2));
  }
}

function openPad(){
  el.jumpInput.value = '';
  jumpBox.classList.add('open');
}
function closePad(restore){
  jumpBox.classList.remove('open');
  if (restore){
    if (isMobile()) syncMobilePage();
    else el.jumpInput.value = state.spread*2 + 1;
  }
}
function doJump(){
  closePad(false);
  jumpTo();
}

export function initJump(){
  jumpBox = document.querySelector('.jump');
  numpad  = document.getElementById('numpad');

  el.jumpInput.max = state.pages.length;
  el.jumpTotal.textContent = 'of ' + state.pages.length;

  el.jumpInput.addEventListener('focus', openPad);
  el.jumpInput.addEventListener('click', openPad);

  /* tapping a folio opens the pad positioned right above THAT number —
     never a fixed spot that only happens to land near it. Same logic on
     every device now that .jump is position:fixed (ui.css): folioEl's
     getBoundingClientRect() is already viewport-relative, which is
     exactly what a fixed element's left/top want, so no anchor or
     offsetParent math is needed regardless of which page (or which leaf,
     on mobile) the folio belongs to.

     Horizontal is clamped to half the NUMPAD's own rendered width (it,
     not the slimmer jump-badge, is the widest thing that has to stay
     on-screen — both share the same centre, via left:50%/translateX(-50%))
     so the pad can't run off either edge of the browser window itself.
     Vertical isn't clamped: the numpad opens upward from the badge
     (.numpad's bottom:calc(100% + 10px) in ui.css), and a folio — always
     in the page's own bottom strip — never sits close enough to the top
     of the viewport for that to overflow off-screen.

     focus() runs FIRST, deliberately: it fires openPad() synchronously
     (see the 'focus' listener below), which adds .open and switches numpad
     to display:grid — only then does numpad.offsetWidth report its real
     size rather than 0. */
  document.addEventListener('click', e=>{
    const folioEl = e.target.closest('.folio');
    if (!folioEl) return;
    el.jumpInput.focus();
    const fr = folioEl.getBoundingClientRect();
    const half = (numpad.offsetWidth || jumpBox.offsetWidth || 80) / 2;
    const targetX = Math.min(Math.max(fr.left + fr.width / 2, half), window.innerWidth - half);
    jumpBox.style.left = targetX + 'px';
    jumpBox.style.top = fr.top + 'px';
  });

  numpad.addEventListener('click', e=>{
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'del') el.jumpInput.value = el.jumpInput.value.slice(0, -1);
    else if (k === 'go') doJump();
    else if (el.jumpInput.value.length < 3) el.jumpInput.value += k;
  });

  /* physical keyboard still works on desktop (input is readonly, so we type for it) */
  el.jumpInput.addEventListener('keydown', e=>{
    if (e.key === 'Enter'){ e.preventDefault(); doJump(); }
    else if (e.key === 'Escape'){ closePad(true); el.jumpInput.blur(); }
    else if (e.key === 'Backspace'){ e.preventDefault(); el.jumpInput.value = el.jumpInput.value.slice(0, -1); }
    else if (/^[0-9]$/.test(e.key)){ e.preventDefault(); if (el.jumpInput.value.length < 3) el.jumpInput.value += e.key; }
  });

  /* tapping anywhere outside cancels and restores the current page number */
  document.addEventListener('pointerdown', e=>{
    if (jumpBox.classList.contains('open') && !jumpBox.contains(e.target)) closePad(true);
  });

  /* on mobile, the box tracks the page you've scrolled to (paused while the pad is open) */
  let scrollTick = false;
  window.addEventListener('scroll', ()=>{
    if (!isMobile() || scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(()=>{
      scrollTick = false;
      if (jumpBox.classList.contains('open')) return;
      syncMobilePage();
    });
  }, {passive:true});
}
