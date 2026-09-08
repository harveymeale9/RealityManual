// Shared login gate for the control panel and the quick-add shortcut.
// Deliberately simple client-side password check per Harvey's instruction —
// not meant to be a real security boundary.
window.RMAuth = (function () {
  var PANEL_PASSWORD = 'ormiston';
  var AUTH_KEY = 'rm_panel_auth';

  function isAuthed() {
    try { return localStorage.getItem(AUTH_KEY) === '1'; }
    catch (e) { return false; }
  }

  function setAuthed(v) {
    try {
      if (v) localStorage.setItem(AUTH_KEY, '1');
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) {}
  }

  function checkPassword(pw) { return pw === PANEL_PASSWORD; }

  return { isAuthed: isAuthed, setAuthed: setAuthed, checkPassword: checkPassword };
})();
