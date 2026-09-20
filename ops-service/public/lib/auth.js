// Shared login gate for the control panel and the quick-add shortcut.
// No localStorage/browser storage involved at all — the only persistence
// is the server's own httpOnly session cookie (invisible to this JS),
// set by /api/login. Every page load asks the server "is this session
// actually valid?" rather than trusting any client-side flag, so a device
// can never drift into a state where it *thinks* it's logged in but has
// no real session (that mismatch used to cause a permanently-empty board).
window.RMAuth = (function () {
  var API_BASE = window.RMStore ? window.RMStore.API_BASE : 'https://ops.realitymanual.com';

  // Resolves to `{ ok: true, role: 'admin' | 'youtube-reviewer' }` (still
  // truthy, so existing `if (result)` callers keep working unchanged) or
  // `false` — the role lets callers that care (app.js) show a genuinely
  // restricted view for a reviewer session, not just gate on "logged in
  // or not."
  function checkSession() {
    return fetch(API_BASE + '/api/me', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return data || false; })
      .catch(function () { return false; });
  }

  function checkPassword(pw) {
    return fetch(API_BASE + '/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return data || false; })
      .catch(function () { return false; });
  }

  function logout() {
    return fetch(API_BASE + '/api/logout', { method: 'POST', credentials: 'include' }).catch(function () {});
  }

  return { checkSession: checkSession, checkPassword: checkPassword, logout: logout };
})();
