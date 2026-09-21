'use strict';

// A compact map of the manuscript's recurring intellectual machinery. The
// generation agent still reads the canonical manuscript; this catalogue keeps
// it conscious of the named rules and house definitions while developing an
// angle, instead of treating each source passage as an isolated quotation.
const RULES = [
  ['I', 'Internal Value', 'Nothing in physical reality has inherent value except emotional experience; circumstances matter only through their effect on emotion.', 9],
  ['II', 'Required Belief', 'Emotion requires a prior belief, and the emotion experienced must be compatible with that belief.', 32],
  ['III', 'Bidirectional Belief', 'Meaning, belief, and emotion are reciprocal; changing any one can change the others.', 36],
  ['IV', 'Unknown Truth', 'When truth is unknown, the strategically valuable belief is the genuinely believable one expected to maximize emotional well-being, held provisionally and revised when truth becomes known.', 45],
  ['V', 'Oneness', 'Positive emotion arises from increased oneness and negative emotion from increased separation.', 57],
  ['VI', 'Functional Existence', 'The purpose of a thing is the function it performs; the purpose of one\'s existence is the function one performs.', 81],
  ['VII', 'Expansive Existence', 'An infinite being\'s nature is to expand; resisting expansion acts against that nature and lowers emotional well-being.', 86],
  ['VIII', 'Freedom', 'Freedom scales with emotional well-being: greater well-being expands action toward desirable states, while lower well-being constrains action toward preventing further deterioration.', 89],
  ['IX', 'Desire', 'All positive emotion results from fulfilled desire, conscious or unconscious; all negative emotion indicates unmet desire.', 95],
  ['X', 'Tripartite Rule', 'Human behavior emerges from the interplay of the body, conscious mind, and subconscious mind.', 104],
  ['XI', 'Subconscious Action', 'Every action is ultimately a subconscious attempt to preserve or improve emotional well-being; the subconscious selects what it expects to be most emotionally rewarding.', 109],
  ['XII', 'Motivation', 'The incentive to change action equals the gap between current emotional well-being and subconsciously expected emotional well-being.', 120],
  ['XIII', 'Innovation', 'The degree to which life strategy should change is inversely correlated with emotional well-being.', 123],
  ['XIV', 'Crystallized Emotion', 'A subconscious belief is the crystallized amalgamation of relevant emotional experience: an emotional signature, not fundamentally a sentence or proposition.', 128]
];

const PILLARS = [
  'The objective of life is to maximize emotional well-being (EWB): the average net emotional value of experience across a lifetime, scored through valence, intensity, and duration (pages 14-16, 24-26).',
  'Actions and strategy are inputs; emotional well-being is the scoreboard/output. It can only be influenced indirectly through belief, oneness, expansion, freedom, and desire—the five axes (pages 15-17).',
  'Lifetime length does not itself improve the average quality of a life. Negative emotion has negative experiential value but can still have strategic value (pages 26-27).',
  'Love means recognizing oneself in another and desiring the other\'s well-being as one\'s own: the intentional dissolution of the boundary between self and other (page 66).',
  'God is all that is, not a separate being inside or outside creation; oneness is godliness, and each individual is an expression of the infinite whole (pages 74-86).',
  'Heaven on Earth and Hell on Earth are internal poles of emotional well-being. Heaven approaches desirelessness; Hell approaches maximum unresolved desire (pages 96-99, 174-175).',
  'Desire is resolved by fulfilment through action or by dissolution when fulfilment is futile, too costly, or no longer truly desirable (pages 100-103, 160-164).',
  'Triple alignment means desire, required action, and subconscious belief point in the same direction, making action effortless; the Panacea Process restores this alignment (pages 140-159).',
  'FIRR—Fully Integrated Responsive Reprogramming—repeatedly replaces an automatic emotional response with an embodied chosen state until the new response becomes subconscious and automatic (pages 165-173).',
  'Enlightenment is Heaven on Earth expressed through transcended desire, oneness with all existence, and maximized emotional well-being (pages 176-180).'
];

function promptText() {
  const rules = RULES.map(function (rule) {
    const name = rule[0] === 'X' ? 'The Tripartite Rule' : 'The Rule of ' + rule[1];
    return 'Rule ' + rule[0] + ', ' + name + ' (p.' + rule[3] + '): ' + rule[2];
  }).join('\n');
  return 'CORE PILLARS AND DEFINITIONS\n- ' + PILLARS.join('\n- ') + '\n\nTHE FOURTEEN RULES OF REALITY\n' + rules;
}

module.exports = { RULES: RULES, PILLARS: PILLARS, promptText: promptText };
