(function (root) {
  'use strict';

  // Only whole profanities are matched: ordinary words such as "class" and
  // "assistant" must never be changed. Keep the spoken transcript untouched;
  // this function is for text shown to viewers.
  var swearWords = /\b(?:motherfuckers?|motherfucking|bullshitting|bullshits?|assholes?|bastards?|goddamn|fucking|fuckers?|fucked|fucks?|fuckin|shitty|shits?|bitches|bitching|bitchy|bitch|cunts?|dicks?|pissing|pissed|piss|crappy|crap|damned|damn|arse|ass|twat|wanker)\b/gi;

  function maskCaption(text) {
    return String(text == null ? '' : text).replace(swearWords, function (word) {
      var lower = word.toLowerCase();
      // Mask the recognizable swear inside compounds, without changing case.
      var start = lower.indexOf('fuck');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('shit');
      if (start !== -1) return word.slice(0, start + 2) + '*' + word.slice(start + 3);
      start = lower.indexOf('bitch');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('cunt');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('dick');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('piss');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('asshole');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('bastard');
      if (start !== -1) return word.slice(0, start + 1) + '*' + word.slice(start + 2);
      start = lower.indexOf('crap');
      if (start === -1) start = lower.indexOf('damn');
      if (start === -1) start = lower.indexOf('arse');
      if (start === -1) start = lower.indexOf('ass');
      if (start === -1) start = lower.indexOf('twat');
      if (start === -1) start = lower.indexOf('wanker');
      return start === -1 ? word : word.slice(0, start + 1) + '*' + word.slice(start + 2);
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { maskCaption: maskCaption };
  if (root) root.RealityCaptionMask = { maskCaption: maskCaption };
})(typeof window !== 'undefined' ? window : null);
