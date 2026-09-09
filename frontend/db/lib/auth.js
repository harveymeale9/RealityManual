// Shared login gate for the control panel and the quick-add shortcut.
// The password check now happens server-side against rm-ops-service, which
// sets a real (httpOnly) session cookie on success — this file just tracks
// a fast local "am I probably logged in" flag for UI purposes. Actual data
// access is enforced by the server checking the session cookie on every
// request, not by this flag.
window.RMAuth = (function () {
  var API_BASE = window.RMStore ? window.RMStore.API_BASE : 'https://ops.realitymanual.com';
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

  function checkPassword(pw) {
    return fetch(API_BASE + '/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function logout() {
    setAuthed(false);
    return fetch(API_BASE + '/api/logout', { method: 'POST', credentials: 'include' }).catch(function () {});
  }

  return { isAuthed: isAuthed, setAuthed: setAuthed, checkPassword: checkPassword, logout: logout };
})();
