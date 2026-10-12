'use strict';

// Final Check has one publishing policy, not a user-selectable visibility
// choice. Harvey's real releases are always public. The deliberately scoped
// YouTube reviewer account remains private so an external compliance reviewer
// cannot make a public post from its sandbox access.
function youtubePrivacyStatus(sessionRole) {
  return sessionRole === 'youtube-reviewer' ? 'private' : 'public';
}

module.exports = { youtubePrivacyStatus: youtubePrivacyStatus };
