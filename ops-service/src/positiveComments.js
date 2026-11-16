'use strict';

// Intentionally conservative: this is a quiet appreciation feed, not a
// general sentiment classifier. Ambiguous/mixed/question comments stay out.
// Favor feedback about Harvey's work or its effect on the viewer. A passing
// "thanks" after a long unrelated opinion is not an appreciation card.
const IMPACT = /\b(?:you (?:have |just )?helped (?:me|us)|this helped (?:me|us)|(?:this|your) (?:video|videos|content|work|book|message) (?:has |have |really )?(?:helped|changed|inspired|motivated) (?:me|us|my|how I)|(?:this|your) (?:video|videos|content|work|book|message) (?:is|was) life.changing|(?:this|your) (?:video|videos|content|work|book|message) (?:made me|makes me)|I needed (?:this|to hear this)|(?:thanks|thank you) for (?:helping|inspiring|motivating) me)\b/i;
const PRAISE = /\b(?:love|loved) (?:this(?: video| content)?|your (?:work|content|videos?|book|channel|message))\b|\b(?:great|amazing|brilliant|excellent|beautiful|inspiring|inspirational|helpful|insightful|powerful) (?:video|content|work|explanation|message|channel|insight|perspective)\b|\b(?:your|this|these) (?:video|videos|content|work|explanation|message|channel|insight|perspective) (?:is|are|was|were) (?:great|amazing|brilliant|excellent|beautiful|inspiring|inspirational|helpful|insightful|powerful)\b|\b(?:beautifully (?:said|explained)|well said|keep (?:it|this) up|this is gold|spot on|you nailed it|so insightful|mind.?blowing)\b/i;
const DETAILED_GRATITUDE = /\b(?:thank you|thanks) (?:so much )?for (?:making|creating|sharing) (?:this|these|your) (?:video|videos|content|work)|\bI (?:really |truly )?appreciate (?:your|this) (?:work|content|videos?|message)/i;
const UNCERTAIN = /[?？]|\b(but|however|although|though|except|not|never|don't|doesn't|cannot|can't|confus(?:ed|ing)|disagree|wrong|bad|hate|stupid|idiot|scam|fake|misleading|unsure|wish you|could you|please explain|why would|what about)\b/i;

function clearlyPositive(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length < 8 || value.length > 600) return false;
  if (/https?:\/\/|www\.|@\w+|(?:\$|€|£)\s*\d/i.test(value)) return false;
  if (UNCERTAIN.test(value)) return false;
  if (IMPACT.test(value) || PRAISE.test(value)) return true;
  // A courtesy "thanks" by itself does not describe praise or impact.
  return DETAILED_GRATITUDE.test(value);
}

function normalizeComment(comment, videoId, channelId) {
  const snippet = comment && comment.snippet || {};
  if (!comment || !comment.id || !videoId || snippet.authorChannelId && snippet.authorChannelId.value === channelId) return null;
  const text = String(snippet.textDisplay || '').replace(/\s+/g, ' ').trim();
  if (!clearlyPositive(text)) return null;
  const publishedAt = snippet.publishedAt || '';
  if (!Number.isFinite(Date.parse(publishedAt))) return null;
  return {
    id: String(comment.id), videoId: String(videoId), author: String(snippet.authorDisplayName || 'YouTube viewer').slice(0, 100),
    text: text, publishedAt: publishedAt,
    url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) + '&lc=' + encodeURIComponent(comment.id)
  };
}

function create(options) {
  const fetchThreads = options.fetchThreads;
  const fetchReplies = options.fetchReplies;
  const fetchVideos = options.fetchVideos;
  const now = options.now || Date.now;
  const maxThreadPages = options.maxThreadPages || 150;
  const maxReplyPages = options.maxReplyPages || 150;
  let state = { channelId: '', comments: [], checkedAt: null, loading: false, partial: false, error: null, requiresReconnect: false };
  let inFlight = null;
  let lastAttempt = 0;
  let revision = 0;

  async function scan(channelId) {
    const found = new Map();
    let threadPage = '';
    let threadPages = 0;
    let replyPages = 0;
    let partial = false;
    do {
      const response = await fetchThreads(channelId, threadPage);
      threadPages++;
      for (const thread of response.items || []) {
        const snippet = thread.snippet || {};
        const videoId = snippet.videoId;
        const top = normalizeComment(snippet.topLevelComment, videoId, channelId);
        if (top) found.set(top.id, top);
        const included = thread.replies && thread.replies.comments || [];
        for (const reply of included) {
          const item = normalizeComment(reply, videoId, channelId);
          if (item) found.set(item.id, item);
        }
        if (Number(snippet.totalReplyCount || 0) > included.length && snippet.topLevelComment && snippet.topLevelComment.id) {
          let replyPage = '';
          do {
            if (replyPages >= maxReplyPages) { partial = true; break; }
            const more = await fetchReplies(snippet.topLevelComment.id, replyPage);
            replyPages++;
            for (const reply of more.items || []) {
              const item = normalizeComment(reply, videoId, channelId);
              if (item) found.set(item.id, item);
            }
            replyPage = more.nextPageToken || '';
          } while (replyPage);
        }
      }
      threadPage = response.nextPageToken || '';
      if (threadPage && threadPages >= maxThreadPages) { partial = true; break; }
    } while (threadPage);
    const comments = Array.from(found.values()).sort(function (a, b) {
      return b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id);
    }).slice(0, 100);
    if (comments.length && fetchVideos) {
      try {
        const titles = await fetchVideos(Array.from(new Set(comments.map(function (comment) { return comment.videoId; }))));
        const byId = new Map((titles || []).map(function (video) { return [String(video.id), String(video.title || '').trim().slice(0, 180)]; }));
        comments.forEach(function (comment) { comment.videoTitle = byId.get(comment.videoId) || 'YouTube video'; });
      } catch (error) {
        // A failed title lookup must never hide otherwise valid comments.
        comments.forEach(function (comment) { comment.videoTitle = 'YouTube video'; });
      }
    }
    return { channelId: channelId, comments: comments, checkedAt: new Date(now()).toISOString(), loading: false, partial: partial, error: null, requiresReconnect: false };
  }

  function get(channelId) {
    if (!channelId) return { connected: false, comments: [], loading: false };
    if (state.channelId !== channelId) {
      revision++;
      state = { channelId: channelId, comments: [], checkedAt: null, loading: false, partial: false, error: null, requiresReconnect: false };
      lastAttempt = 0;
    }
    const age = now() - lastAttempt;
    if (!inFlight && (lastAttempt === 0 || age >= (state.error ? 5 * 60000 : 6 * 3600000))) {
      lastAttempt = now();
      state.loading = true;
      const scanRevision = revision;
      inFlight = scan(channelId).then(function (fresh) {
        if (revision === scanRevision && state.channelId === channelId) state = fresh;
      }).catch(function (error) {
        if (revision !== scanRevision || state.channelId !== channelId) return;
        state.loading = false;
        state.requiresReconnect = error && (error.status === 403 || error.reason === 'insufficientPermissions');
        state.error = state.requiresReconnect ? 'Reconnect YouTube in Content Settings to allow comment reading.' : 'YouTube comments are temporarily unavailable.';
      }).finally(function () { inFlight = null; });
    }
    return { connected: true, comments: state.comments, checkedAt: state.checkedAt, loading: state.loading,
      partial: state.partial, error: state.error, requiresReconnect: state.requiresReconnect };
  }

  function invalidate() {
    revision++;
    state = { channelId: '', comments: [], checkedAt: null, loading: false, partial: false, error: null, requiresReconnect: false };
    lastAttempt = 0;
  }

  return { get: get, invalidate: invalidate };
}

module.exports = { clearlyPositive, normalizeComment, create };
