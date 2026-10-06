'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const topicSchedule = require('../src/topicSchedule');

const DAY = 24 * 60 * 60 * 1000;

test('independent long and short cards are matched from their transcripts', function () {
  const longform = {
    id: 'long', sourcePlanningPieceId: 'different-plan-a', title: 'Why Consciousness Is Fundamental',
    transcript: 'Consciousness is the foundation of reality. Matter and the physical world are experiences appearing within consciousness.'
  };
  const short = {
    id: 'short', sourcePlanningPieceId: 'different-plan-b', title: 'Consciousness Is Fundamental',
    transcript: 'The physical material world appears within consciousness rather than matter producing consciousness.'
  };
  assert.ok(topicSchedule.similarity(longform, short) > 0.35);
});

test('lexical topic scoring recognizes related angles but separates unrelated subjects', function () {
  const beliefOne = { title: 'How subconscious beliefs control action', transcript: 'Resistance appears when subconscious belief predicts an undesirable emotional consequence from action.' };
  const beliefTwo = { title: 'Reprogramming a subconscious belief', transcript: 'Change the emotional meaning of a memory and the limiting belief governing your actions can change.' };
  const unrelated = { title: 'Why billionaires create wealth', transcript: 'Economic exchange and scalable production increase the value available to every participant.' };
  assert.ok(topicSchedule.similarity(beliefOne, beliefTwo) > 0.18);
  assert.ok(topicSchedule.similarity(beliefOne, unrelated) < 0.12);
  assert.ok(topicSchedule.similarity(
    { title: 'No Boat Rises Alone While The Tide Around It Falls', transcript: 'one treatment' },
    { title: 'No Boat Rises Alone While The Tide Around It Falls', transcript: 'another treatment' }
  ) < 0.7);
});

test('planning links and tags cannot manufacture topic similarity', function () {
  const one = {
    sourcePlanningPieceId: 'same-reference', tags: ['belief', 'emotion'], title: 'How beliefs change',
    transcript: 'A subconscious belief changes when a memory acquires a different emotional meaning.'
  };
  const two = {
    sourcePlanningPieceId: 'same-reference', tags: ['belief', 'emotion'], title: 'Why scalable trade creates wealth',
    transcript: 'Specialisation, production and voluntary exchange can increase prosperity for every participant.'
  };
  assert.ok(topicSchedule.similarity(one, two) < 0.12);
});

test('topic-aware scheduling sends a duplicate far away while fresh subject matter takes the first slot', function () {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const candidates = Array.from({ length: 11 }, function (_, index) { return new Date(now + (index + 1) * DAY).toISOString(); });
  const existing = [{
    id: 'existing', stage: 'scheduled', scheduledAt: new Date(now + DAY).toISOString(),
    sourcePlanningPieceId: 'plan-1', title: 'Reprogramming Subconscious Beliefs',
    transcript: 'A subconscious belief controls action through the emotional meaning attached to an old memory. Reprogramming that emotion changes the belief.'
  }];
  const duplicate = topicSchedule.chooseSlot({
    id: 'duplicate', sourcePlanningPieceId: 'plan-2', title: 'How to Reprogram a Belief',
    transcript: 'To reprogram a subconscious belief, change the emotional meaning of the memory that governs your actions.'
  }, candidates, existing, now);
  const fresh = topicSchedule.chooseSlot({
    id: 'fresh', title: 'Why Cooperation Creates More Wealth', transcript: 'trade production prosperity abundance'
  }, candidates, existing, now);
  assert.ok(duplicate.separationDays >= 8, JSON.stringify(duplicate));
  assert.equal(duplicate.closestPieceId, 'existing');
  assert.ok(duplicate.similarity >= 0.35, JSON.stringify(duplicate));
  assert.equal(fresh.dueAt, candidates[0]);
});
