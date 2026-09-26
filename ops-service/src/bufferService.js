'use strict';

const crypto = require('crypto');

const API_URL = 'https://api.buffer.com';

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }

function setup(options) {
  options = options || {};
  const apiKey = clean(options.apiKey, 1000);
  const configuredChannelId = clean(options.tiktokChannelId, 300);
  const fetchImpl = options.fetchImpl || fetch;
  const mediaBaseUrl = clean(options.mediaBaseUrl || 'https://ops.realitymanual.com', 500).replace(/\/$/, '');

  async function graphql(query, variables) {
    if (!apiKey) throw new Error('Buffer API key is not configured.');
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ query: query, variables: variables || {} })
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error('Buffer API HTTP ' + response.status + '.');
    if (payload.errors && payload.errors.length) throw new Error('Buffer API: ' + clean(payload.errors[0].message, 500));
    return payload.data || {};
  }

  async function listChannels() {
    const account = await graphql('query { account { organizations { id name } } }');
    const organizations = account.account && account.account.organizations || [];
    const channels = [];
    for (const organization of organizations) {
      const data = await graphql('query Channels($input: ChannelsInput!) { channels(input: $input) { id displayName descriptor service isDisconnected isLocked isQueuePaused externalLink } }',
        { input: { organizationId: organization.id } });
      (data.channels || []).forEach(function (channel) {
        channels.push(Object.assign({ organizationId: organization.id, organizationName: organization.name }, channel));
      });
    }
    return channels;
  }

  async function resolveTiktokChannel() {
    const channels = await listChannels();
    if (configuredChannelId) {
      const selected = channels.find(function (channel) { return channel.id === configuredChannelId; });
      if (!selected) throw new Error('BUFFER_TIKTOK_CHANNEL_ID does not match an accessible Buffer channel.');
      if (String(selected.service).toLowerCase() !== 'tiktok') throw new Error('Configured Buffer channel is not TikTok.');
      return selected;
    }
    const candidates = channels.filter(function (channel) { return String(channel.service).toLowerCase() === 'tiktok'; });
    if (!candidates.length) throw new Error('No TikTok channel is connected in Buffer.');
    if (candidates.length > 1) throw new Error('Multiple TikTok channels found; set BUFFER_TIKTOK_CHANNEL_ID explicitly.');
    return candidates[0];
  }

  function signMedia(pieceId, expires) {
    if (!apiKey) throw new Error('Buffer API key is not configured.');
    return crypto.createHmac('sha256', apiKey).update(pieceId + '\n' + String(expires)).digest('hex');
  }

  function mediaUrl(pieceId, lifetimeMs) {
    const expires = Date.now() + (Number(lifetimeMs) || 24 * 60 * 60 * 1000);
    return mediaBaseUrl + '/api/buffer/media/' + encodeURIComponent(pieceId) + '?expires=' + expires + '&sig=' + signMedia(pieceId, expires);
  }

  function verifyMediaSignature(pieceId, expires, signature) {
    const expiresNumber = Number(expires);
    if (!apiKey || !Number.isFinite(expiresNumber) || expiresNumber < Date.now() || expiresNumber > Date.now() + 7 * 24 * 60 * 60 * 1000) return false;
    const expected = Buffer.from(signMedia(pieceId, expiresNumber), 'hex');
    let actual;
    try { actual = Buffer.from(String(signature || ''), 'hex'); } catch (error) { return false; }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  async function createTiktokVideoPost(input) {
    const channel = await resolveTiktokChannel();
    if (channel.isDisconnected || channel.isLocked) throw new Error('The Buffer TikTok channel is disconnected or locked.');
    const data = await graphql(`mutation CreateVideoPost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id text status dueAt } }
        ... on MutationError { message }
      }
    }`, { input: {
      text: clean(input.text, 2200), channelId: channel.id,
      schedulingType: 'automatic', mode: 'addToQueue', aiAssisted: false,
      assets: [{ video: { url: input.videoUrl, metadata: { thumbnailOffset: Math.max(0, Math.round(Number(input.thumbnailOffset) || 0)) } } }],
      metadata: { tiktok: { isAiGenerated: false } }
    } });
    const result = data.createPost || {};
    if (!result.post) throw new Error('Buffer could not create the TikTok post: ' + clean(result.message || result.__typename || 'unknown error', 500));
    return { post: result.post, channel: channel };
  }

  async function status() {
    if (!apiKey) return { configured: false, connected: false, reason: 'missing_api_key' };
    try {
      const channel = await resolveTiktokChannel();
      return { configured: true, connected: !channel.isDisconnected && !channel.isLocked,
        channel: { id: channel.id, displayName: channel.displayName, descriptor: channel.descriptor,
          isDisconnected: channel.isDisconnected, isLocked: channel.isLocked, isQueuePaused: channel.isQueuePaused } };
    } catch (error) {
      return { configured: true, connected: false, reason: clean(error.message, 500) };
    }
  }

  return { configured: !!apiKey, graphql: graphql, listChannels: listChannels, resolveTiktokChannel: resolveTiktokChannel,
    createTiktokVideoPost: createTiktokVideoPost, mediaUrl: mediaUrl, verifyMediaSignature: verifyMediaSignature, status: status };
}

module.exports = { setup: setup, API_URL: API_URL };
