'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const topicSchedule = require('../src/topicSchedule');

const DAY = 24 * 60 * 60 * 1000;

test('planning-linked long and short versions are treated as the same topic without AI', function () {
  const longform = {
    id: 'long', sourcePlanningPieceId: 'plan-32', title: 'Why Consciousness Is Fundamental',
    transcript: 'Consciousness is the foundation of reality and matter is experienced within it.'
  };
  const short = {
    id: 'short', sourcePlanningPieceId: 'plan-32', title: 'Consciousness Is Fundamental',
    transcript: 'The material world appears within consciousness rather than producing it.'
  };
  assert.equal(topicSchedule.similarity(longform, short), 1);
});

test('lexical topic scoring recognizes related angles but separates unrelated subjects', function () {
  const beliefOne = { title: 'How subconscious beliefs control action', transcript: 'Resistance appears when subconscious belief predicts an undesirable emotional consequence from action.' };
  const beliefTwo = { title: 'Reprogramming a subconscious belief', transcript: 'Change the emotional meaning of a memory and the limiting belief governing your actions can change.' };
  const unrelated = { title: 'Why billionaires create wealth', transcript: 'Economic exchange and scalable production increase the value available to every participant.' };
  assert.ok(topicSchedule.similarity(beliefOne, beliefTwo) > 0.25);
  assert.ok(topicSchedule.similarity(beliefOne, unrelated) < 0.12);
  assert.equal(topicSchedule.similarity(
    { title: 'No Boat Rises Alone While The Tide Around It Falls', transcript: 'one treatment' },
    { title: 'No Boat Rises Alone While The Tide Around It Falls', transcript: 'another treatment' }
  ), 0.95);
});

test('topic-aware scheduling sends a duplicate far away while fresh subject matter takes the first slot', function () {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const candidates = Array.from({ length: 11 }, function (_, index) { return new Date(now + (index + 1) * DAY).toISOString(); });
  const existing = [{
    id: 'existing', stage: 'scheduled', scheduledAt: new Date(now + DAY).toISOString(),
    sourcePlanningPieceId: 'plan-1', title: 'Reprogramming Subconscious Beliefs', transcript: 'belief emotion action'
  }];
  const duplicate = topicSchedule.chooseSlot({
    id: 'duplicate', sourcePlanningPieceId: 'plan-1', title: 'How to Reprogram a Belief', transcript: 'belief emotion action'
  }, candidates, existing, now);
  const fresh = topicSchedule.chooseSlot({
    id: 'fresh', title: 'Why Cooperation Creates More Wealth', transcript: 'trade production prosperity abundance'
  }, candidates, existing, now);
  assert.ok(duplicate.separationDays >= 9, JSON.stringify(duplicate));
  assert.equal(duplicate.closestPieceId, 'existing');
  assert.equal(duplicate.similarity, 1);
  assert.equal(fresh.dueAt, candidates[0]);
});
