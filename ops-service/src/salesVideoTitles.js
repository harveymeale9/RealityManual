'use strict';

// Enrich the private dashboard response only. Historic order attribution stays
// untouched, and an unknown sequence keeps its numeric fallback in the UI.
function addVideoTitlesToOrders(orders, pieces) {
  const titlesBySeq = new Map();
  (pieces || []).forEach(function (piece) {
    const seq = Number(piece && piece.seq);
    if (!Number.isInteger(seq) || seq <= 0) return;
    const selectedYouTubeTitle = Array.isArray(piece.ytTitles) ? piece.ytTitles[0] : '';
    const title = String(selectedYouTubeTitle || piece.title || '').trim().slice(0, 200);
    if (title) titlesBySeq.set(String(seq), title);
  });
  (orders || []).forEach(function (order) {
    const attribution = order && order.attribution;
    if (!attribution) return;
    ['first', 'last_tagged'].forEach(function (key) {
      const touch = attribution[key];
      if (!touch || String(touch.source || '').toLowerCase() !== 'youtube') return;
      const content = String(touch.content || '');
      if (!/^\d{1,6}$/.test(content)) return;
      const title = titlesBySeq.get(String(Number(content)));
      if (title) touch.video_title = title;
    });
  });
  return orders;
}

module.exports = { addVideoTitlesToOrders };
