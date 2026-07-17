/* ==========================================================
   MAIN — load the book, wire the controls, open it
   ========================================================== */

import { loadBook } from './loader.js?v=1';
import { el, state, cacheDom, isMobile, render, buildScrollBook, savedPageIndex } from './book.js?v=1';
import { requestGo } from './page-turn.js?v=1';
import { initJump, syncMobilePage } from './jump.js?v=1';
import { initFullscreen } from './fullscreen.js?v=1';

/* reveal once fonts are in, so the whole book paints in its final form;
   the timeout guarantees reveal even if font loading stalls */
function reveal(){ document.body.classList.add('ready'); }

function wireControls(){
  document.getElementById('btnNext').addEventListener('click', ()=>requestGo(1));
  document.getElementById('btnPrev').addEventListener('click', ()=>requestGo(-1));
  document.getElementById('sideRight').addEventListener('click', ()=>requestGo(1));
  document.getElementById('sideLeft').addEventListener('click', ()=>requestGo(-1));
  document.addEventListener('keydown', e=>{
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') requestGo(1);
    if (e.key === 'ArrowLeft') requestGo(-1);
  });
  window.addEventListener('resize', render);
}

/* ---- resume where the reader left off (looked up by slug) ---- */
function restorePosition(){
  const idx = savedPageIndex();
  if (isMobile()){
    if (idx < 0){ el.jumpInput.value = 1; return; }
    el.jumpInput.value = idx + 1;
    /* wait a frame so the scroll stack has laid out before we jump to it */
    requestAnimationFrame(()=>{
      const node = document.querySelectorAll('#scrollBook .page.m')[idx];
      if (node) node.scrollIntoView({ behavior:'auto', block:'start' });
    });
  } else if (idx >= 0){
    state.spread = Math.min(Math.max(Math.floor(idx/2), 0), state.maxSpread);
  }
}

function showLoadError(err){
  console.error(err);
  const onFile = location.protocol === 'file:';
  document.getElementById('bookError').innerHTML = onFile
    ? `<h2>The book must be served, not opened directly</h2>
       <p>Browsers refuse to <code>fetch</code> local files over <code>file://</code>,
          so the pages can't be read. From this folder, run:</p>
       <p><code>python3 -m http.server 8000</code></p>
       <p>then visit <code>http://localhost:8000</code>.</p>`
    : `<h2>The book could not be opened</h2>
       <p><code>${err.message}</code></p>
       <p>Check that <code>book.json</code> lists only pages that exist in <code>/pages</code>.</p>`;
  document.body.classList.add('load-failed','ready');
}

/* wired unconditionally, before the book even loads — it's page chrome,
   not book content, and should still work on the load-error screen */
initFullscreen();

/* no reason for a reader to right-click their way into "Inspect" */
document.addEventListener('contextmenu', e => e.preventDefault());

(async function open(){
  try{
    cacheDom();
    const { title, pages } = await loadBook();

    state.pages = pages;
    state.maxSpread = Math.ceil(pages.length / 2) - 1;

    if (title){
      document.title = `${title} — Digital Grimoire`;
      document.querySelector('header.site h1').textContent = title;
    }

    buildScrollBook();
    initJump();
    wireControls();
    restorePosition();
    render();
    if (isMobile()) syncMobilePage();
  }catch(err){
    showLoadError(err);
    return;
  }

  if (document.fonts && document.fonts.ready){ document.fonts.ready.then(reveal); }
  setTimeout(reveal, 900);
})();
