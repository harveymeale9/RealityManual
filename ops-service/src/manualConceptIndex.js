'use strict';

// The research-sized representation of The Reality Manual. This is deliberately
// much smaller than the manuscript: it is the first-pass comparison vocabulary
// for a thinker's claims. A match is only a candidate. The canonical manuscript
// quote and page attached to every concept are the mandatory second-pass source.
const CONCEPTS = [
  {
    id: 'life-as-a-game', group: 'foundation', title: 'Life Is a Solvable Game', pages: [1, 7],
    thesis: 'Life has interactivity and unequal outcomes, so it can be treated as a game whose objective, rules, and optimal strategy can be discovered rather than improvised.',
    aliases: ['game of life', 'life as a game', 'solve life', 'optimal life strategy', 'rules of reality', 'winning life'],
    quotePage: 1,
    quote: 'Life is often referred to as a game colloquially, but the realization that it is, in fact, indistinguishable from a game is rather noteworthy, for games possess an important property: they can be solved.'
  },
  {
    id: 'objective-emotional-well-being', group: 'foundation', title: 'The Objective: Maximize Emotional Well-Being', pages: [14, 15],
    thesis: 'The single objective of life is to maximize the average net emotional value of experience across one’s lifetime—not wealth, status, achievement, or any other proxy.',
    aliases: ['objective of life', 'emotional well-being', 'emotional wellbeing', 'pleasantness of being alive', 'good life', 'life worth living'],
    quotePage: 15,
    quote: 'The objective of the game of life is therefore to maximize one’s emotional well-being, which may be defined as the average net emotional value of all positive and negative emotions experienced throughout one’s lifetime.'
  },
  {
    id: 'emotional-score', group: 'foundation', title: 'The Emotional Score', pages: [15, 24, 25, 26],
    thesis: 'A life is scored by the valence, intensity, and duration of its emotions; emotional well-being is an average quality, so merely living longer does not improve the score.',
    aliases: ['valence intensity duration', 'score of life', 'measure happiness', 'lifetime duration', 'quality of experience'],
    quotePage: 15,
    quote: 'Emotional well-being (EWB) is consequently a measure of the average quality of emotion experienced across the course of one’s life, whereby pleasant emotions contribute positive value, unpleasant emotions contribute negative value, and each contribution is proportional to its valence, intensity, and duration.'
  },
  {
    id: 'strategy-input-scoreboard-output', group: 'foundation', title: 'Action Is the Input; Emotion Is the Scoreboard', pages: [15, 16],
    thesis: 'Emotional well-being cannot be manipulated directly. Action and life strategy are the inputs; emotional experience is the resulting output or scoreboard.',
    aliases: ['inputs and outputs', 'emotional scoreboard', 'action and emotion', 'indirect pursuit', 'strategy determines emotion'],
    quotePage: 16,
    quote: 'The same principle applies to the game of life: emotional well-being is the result to be optimized for, while one’s actions constitute the inputs through which that result may be produced.'
  },
  {
    id: 'five-axes', group: 'foundation', title: 'The Five Axes of Life Strategy', pages: [16, 17],
    thesis: 'Every deliberate attempt to improve emotional well-being operates through one or more of five levers: belief, oneness, expansion, freedom, and desire.',
    aliases: ['five axes', 'belief oneness expansion freedom desire', 'five levers', 'change your life', 'life strategy'],
    quotePage: 16,
    quote: 'There are five fundamental axes through which the objective of life may be pursued: belief, oneness, expansion, freedom, and desire.'
  },
  {
    id: 'two-strategies', group: 'foundation', title: 'The Two Fundamental Strategies', pages: [39, 40, 92],
    thesis: 'One can improve life by increasing positive emotion or reducing negative emotion. Eliminating negative emotion is ultimately the more powerful strategy because it removes the only thing that diminishes well-being.',
    aliases: ['positive emotion negative emotion', 'two strategies', 'reduce suffering', 'increase happiness', 'eliminate negative emotion'],
    quotePage: 39,
    quote: 'There are only two fundamental approaches to such an objective: increase one’s exposure to positive emotions or reduce one’s exposure to negative emotions.'
  },
  {
    id: 'non-zero-sum-life', group: 'foundation', title: 'Life Is Not Zero-Sum', pages: [28, 29],
    thesis: 'One person’s victory need not require another’s defeat; the flourishing of others can enlarge the conditions of one’s own flourishing.',
    aliases: ['non zero sum', 'zero sum', 'shared victory', 'everyone can win', 'cooperation'],
    quotePage: 28,
    quote: 'The game of life is not zero-sum. There is no fixed quantity of victory to be distributed among its participants, such that one person’s success must necessarily constitute another’s failure.'
  },
  {
    id: 'rule-internal-value', group: 'rule', rule: 1, title: 'The Rule of Internal Value', pages: [9, 12],
    thesis: 'Nothing in physical reality has inherent value except emotional experience; objects, events, information, and circumstances are valuable only through their emotional effects.',
    aliases: ['internal value', 'inherent value', 'value of objects', 'emotional value', 'products are proxies', 'emotional transformation'],
    quotePage: 9,
    quote: 'Nothing in the physical universe possesses inherent value except for the experience of emotion.'
  },
  {
    id: 'rule-required-belief', group: 'rule', rule: 2, title: 'The Rule of Required Belief', pages: [31, 32, 33],
    thesis: 'Emotion cannot arise without a prior compatible belief. The same circumstance can therefore produce radically different emotions in different people.',
    aliases: ['required belief', 'belief causes emotion', 'compatible belief', 'same event different emotion'],
    quotePage: 32,
    quote: 'The experience of emotion is contingent upon the prior existence of a belief. The specific emotion experienced must always be compatible with the underlying belief.'
  },
  {
    id: 'rule-bidirectional-belief', group: 'rule', rule: 3, title: 'The Rule of Bidirectional Belief', pages: [34, 35, 36, 37],
    thesis: 'Meaning, belief, and emotion form a reciprocal system. Editing any one can alter the others, making reinterpretation a mechanism for changing both feeling and belief.',
    aliases: ['bidirectional belief', 'reciprocal relationship', 'affect one another reciprocally', 'meaning belief emotion', 'change meaning', 'reframe experience', 'reinterpretation'],
    quotePage: 36,
    quote: 'Meaning, belief, and emotion exist in a reciprocal relationship. Alter the meaning assigned to a circumstance and the associated belief will change, along with the emotion. Alter the associated belief or emotion, and the meaning assigned to the circumstance will likewise change.'
  },
  {
    id: 'belief-generates-meaning', group: 'mechanism', title: 'Belief Generates Meaning', pages: [34, 35],
    thesis: 'Meaning is not stored in external facts. Belief interprets information, interpretation produces meaning, and meaning determines emotional experience.',
    aliases: ['belief determines interpretation', 'meaning of life', 'meaning is created', 'information has no meaning', 'belief interpretation meaning emotion'],
    quotePage: 35,
    quote: 'This relationship can be expressed simply: belief determines interpretation; interpretation determines meaning; and meaning determines the resulting emotional experience.'
  },
  {
    id: 'weaponization-of-belief', group: 'mechanism', title: 'The Weaponization of Belief', pages: [41, 44],
    thesis: 'Beliefs are strategic variables, not fixed inheritances. They can be examined and deliberately cultivated for the emotional lives they create.',
    aliases: ['weaponize belief', 'design beliefs', 'cultivate belief', 'beliefs are malleable', 'choose beliefs'],
    quotePage: 43,
    quote: 'The beliefs through which one experiences reality are therefore not fixed properties of the individual, but variables that may be consciously designed.'
  },
  {
    id: 'rule-unknown-truth', group: 'rule', rule: 4, title: 'The Rule of Unknown Truth', pages: [45, 54],
    thesis: 'When objective truth is unknown, adopt the genuinely believable provisional belief expected to maximize emotional well-being, while remaining willing to revise it when truth becomes known.',
    aliases: ['unknown truth', 'uncertainty', 'agnosticism', 'belief without proof', 'choose useful belief', 'provisional belief'],
    quotePage: 45,
    quote: 'However, when the truth is presently unknown or unknowable, one ought to adopt whichever belief is thought to maximize one’s emotional well-being, provided one can attain genuine conviction to hold such a belief, and provided one remains willing to revise it should objective truth later become known.'
  },
  {
    id: 'rule-oneness', group: 'rule', rule: 5, title: 'The Rule of Oneness', pages: [57, 69],
    thesis: 'Positive emotion arises from increased oneness and negative emotion from increased separation; every action moves experience toward one pole or the other.',
    aliases: ['oneness', 'separation', 'unity', 'connection', 'interconnectedness', 'positive emotion'],
    quotePage: 57,
    quote: 'Positive emotions arise from increased oneness. Negative emotions arise from increased separation. These are not independent forces, but opposite ends of the same continuum.'
  },
  {
    id: 'love-as-practiced-oneness', group: 'metaphysics', title: 'Love Is Practiced Oneness', pages: [66, 69],
    thesis: 'Love is recognizing oneself in another and desiring their well-being as one’s own. Unconditional love deliberately dissolves the boundary between self and other.',
    aliases: ['definition of love', 'unconditional love', 'self and other', 'love everyone', 'love as oneness'],
    quotePage: 66,
    quote: 'Love can now be defined with precision. It is the recognition of oneself in another, and the resulting desire for the other’s well-being as one’s own.'
  },
  {
    id: 'consciousness-and-differentiation', group: 'metaphysics', title: 'Consciousness and Differentiation Co-Create Reality', pages: [70, 74],
    thesis: 'Consciousness provides the experiencer and differentiation provides what can be experienced; physical reality emerges through their co-creation.',
    aliases: ['consciousness fundamental', 'nature of reality', 'differentiation', 'why something exists', 'observer reality'],
    quotePage: 74,
    quote: 'Consciousness is the experiencer. Differentiation is the experienced. Reality is the product of their co-creation.'
  },
  {
    id: 'god-and-the-veil', group: 'metaphysics', title: 'God, the Veil, and the Infinite Self', pages: [74, 80],
    thesis: 'God is all that is rather than a separate creator. Individual beings are veiled expressions of that whole, and life permits the rediscovery and embodiment of their underlying oneness.',
    aliases: ['god is all that is', 'veil of forgetfulness', 'infinite self', 'true nature', 'godliness', 'rediscovery'],
    quotePage: 75,
    quote: 'God is not the ultimate thing within existence, nor the supreme thing standing above all other things. God is all things. God is all that is.'
  },
  {
    id: 'rule-functional-existence', group: 'rule', rule: 6, title: 'The Rule of Functional Existence', pages: [81, 83],
    thesis: 'The purpose of a thing is the function it performs within the larger system of which it is part; one’s purpose is therefore expressed through one’s function.',
    aliases: ['functional existence', 'purpose of life', 'function and purpose', 'calling', 'why i exist'],
    quotePage: 81,
    quote: 'The purpose of a thing’s existence is the function it performs. Nature creates nothing without function. Therefore, the purpose of one’s existence is the function one performs.'
  },
  {
    id: 'rule-expansive-existence', group: 'rule', rule: 7, title: 'The Rule of Expansive Existence', pages: [84, 88],
    thesis: 'As an infinite being, one’s nature is expansion: increasing what one can experience, express, understand, or create. Persistent contraction opposes that nature and lowers well-being.',
    aliases: ['expansive existence', 'expansion', 'growth', 'learning creating exploring', 'contraction', 'infinite being'],
    quotePage: 86,
    quote: 'As an infinite being, one’s nature is to expand. Expansion is therefore not simply desirable, but the natural state of equilibrium for an infinite being.'
  },
  {
    id: 'rule-freedom', group: 'rule', rule: 8, title: 'The Rule of Freedom', pages: [89, 91],
    thesis: 'Freedom and emotional well-being scale together: well-being frees action toward desirable states, while suffering constrains action toward preventing further deterioration.',
    aliases: ['rule of freedom', 'freedom', 'unfreedom', 'do what you want', 'time autonomy', 'emotional freedom'],
    quotePage: 89,
    quote: 'Freedom scales directly with emotional well-being. The greater one’s emotional well-being, the greater one’s freedom to act toward desirable emotional states; the lower one’s emotional well-being, the more one’s freedom of action becomes constrained by the need to prevent further emotional deterioration.'
  },
  {
    id: 'problems-are-negative-emotion', group: 'mechanism', title: 'Every Problem Terminates in Negative Emotion', pages: [92, 94],
    thesis: 'Circumstances become problems only insofar as they produce negative emotion. A problem is structurally resolved when its negative emotional component is eliminated.',
    aliases: ['solution to all problems', 'what is a problem', 'negative emotion', 'panacea', 'circumstances are not problems'],
    quotePage: 93,
    quote: 'Every problem is therefore structurally identical: the experience of a negative emotion in relation to some aspect of reality.'
  },
  {
    id: 'rule-desire', group: 'rule', rule: 9, title: 'The Rule of Desire', pages: [95, 103],
    thesis: 'Positive emotion results from fulfilled desire; negative emotion indicates unmet desire. The intensity of desire determines the emotional stakes of fulfillment or non-fulfillment.',
    aliases: ['rule of desire', 'fulfilled desire', 'unmet desire', 'wanting', 'source of emotion', 'desirelessness'],
    quotePage: 95,
    quote: 'All positive emotions result from the fulfilment of a desire, whether that desire is consciously or unconsciously held. All negative emotions indicate the presence of unmet desires.'
  },
  {
    id: 'fulfilment-or-dissolution', group: 'mechanism', title: 'Desire Ends Through Fulfilment or Dissolution', pages: [100, 103, 160, 164],
    thesis: 'An unmet desire can be resolved by changing reality through action until it is fulfilled, or by changing the belief that makes the circumstance desirable until the desire dissolves.',
    aliases: ['fulfilment or dissolution', 'fulfillment or dissolution', 'let go of desire', 'accept reality', 'change reality or desire'],
    quotePage: 160,
    quote: 'Desire, as one will recall, can ultimately be resolved by one of two means: fulfilment by action or dissolution.'
  },
  {
    id: 'rule-tripartite', group: 'rule', rule: 10, title: 'The Tripartite Rule', pages: [104, 108],
    thesis: 'Behavior emerges from three systems: the conscious mind chooses and strategizes, the subconscious permits and directs action, and the body acts in physical reality.',
    aliases: ['tripartite rule', 'body conscious subconscious', 'three systems', 'how intention becomes action', 'gatekeeper of action'],
    quotePage: 104,
    quote: 'All human behavior emerges from the interplay of three systems: the body, the conscious mind, and the subconscious mind.'
  },
  {
    id: 'rule-subconscious-action', group: 'rule', rule: 11, title: 'The Rule of Subconscious Action', pages: [109, 114],
    thesis: 'No physical action occurs unless the subconscious holds a compatible belief that the action best preserves or improves emotional well-being among the perceived alternatives.',
    aliases: ['subconscious action', 'subconscious belief producing resistance', 'cannot make myself act', 'cannot make themselves act', 'lack discipline', 'procrastination', 'action impossible', 'why people do what they do'],
    quotePage: 109,
    quote: 'The initiation of any action is contingent upon the subconscious belief that said action will contribute to this end.'
  },
  {
    id: 'resistance-is-information', group: 'mechanism', title: 'Resistance Is Information, Not a Discipline Defect', pages: [108, 115, 119],
    thesis: 'Difficulty acting is evidence of a belief-level disagreement, not laziness or insufficient character. The useful question is which trajectory or desirability belief makes resistance rational to the subconscious.',
    aliases: ['resistance', 'discipline', 'willpower', 'self sabotage', 'lazy', 'procrastination', 'trajectory belief', 'desirability belief'],
    quotePage: 115,
    quote: 'Resistance should therefore be treated as information before it is treated as an obstacle. When it appears, the intelligent question is not, “How can this resistance be crushed?” but, “What belief is producing it?”'
  },
  {
    id: 'rule-motivation', group: 'rule', rule: 12, title: 'The Rule of Motivation', pages: [120, 122],
    thesis: 'Motivation is the perceived emotional gap between the present and the future expected from an action; larger expected improvement creates greater incentive to change.',
    aliases: ['rule of motivation', 'motivation gap', 'incentive to act', 'expected future', 'resistance and motivation'],
    quotePage: 120,
    quote: 'The incentive to change one’s actions is equal to the size of the divergence between one’s current emotional well-being and one’s subconsciously expected emotional well-being.'
  },
  {
    id: 'rule-innovation', group: 'rule', rule: 13, title: 'The Rule of Innovation', pages: [123, 126],
    thesis: 'The worse the emotional output of a life strategy, the more radically it should change; the better the output, the less innovation is warranted.',
    aliases: ['rule of innovation', 'change strategy', 'try something new', 'reinvent life', 'strategy adjustment'],
    quotePage: 123,
    quote: 'The degree to which one should alter one’s life strategy is inversely correlated with one’s emotional well-being.'
  },
  {
    id: 'rule-crystallized-emotion', group: 'rule', rule: 14, title: 'The Rule of Crystallized Emotion', pages: [127, 135],
    thesis: 'A subconscious belief is not fundamentally a sentence; it is the crystallized emotional record of relevant past experiences and can be edited by changing their emotional meaning.',
    aliases: ['crystallized emotion', 'subconscious belief', 'emotional history', 'trauma', 'conditioning', 'belief formation'],
    quotePage: 128,
    quote: 'A subconscious belief is the crystallized amalgamation of all previous relevant emotional experiences. Every subconscious belief is therefore an emotional record of the history associated with the subject to which it pertains.'
  },
  {
    id: 'cycle-of-action', group: 'method', title: 'The Cycle of Action', pages: [136, 139],
    thesis: 'Action produces emotion, emotion alters subconscious belief, and belief determines future available action. The loop can compound into either a virtuous or vicious cycle.',
    aliases: ['cycle of action', 'action emotion belief', 'feedback loop', 'vicious cycle', 'virtuous cycle'],
    quotePage: 136,
    quote: 'One takes an action within physical reality, that action produces an emotional reaction, that emotional experience contributes to the formation or alteration of a subconscious belief, and that subconscious belief subsequently influences which actions become available.'
  },
  {
    id: 'triple-alignment', group: 'method', title: 'Triple Alignment', pages: [140, 142],
    thesis: 'Action becomes effortless when the desired outcome, the required actions, and the subconscious beliefs governing those actions all point in the same direction.',
    aliases: ['triple alignment', 'effortless action', 'desire action belief', 'non resistance', 'alignment'],
    quotePage: 140,
    quote: 'Triple alignment is the natural state of non-resistance: a state in which one’s desires, actions, and subconscious beliefs all flow in the same direction.'
  },
  {
    id: 'panacea-process', group: 'method', title: 'The Panacea Process', pages: [136, 159],
    thesis: 'Define the emotion and desired outcome, specify the action path, identify the limiting belief and its originating emotional experience, then alter its meaning until compatible belief and effortless action are restored.',
    aliases: ['panacea process', 'reprogram subconscious belief', 'alter meaning', 'limiting belief', 'restore alignment', 'six steps'],
    quotePage: 158,
    quote: 'Identify the limiting belief, locate the emotional experience from which it was formed, revisit that experience, and alter its meaning until the new interpretation feels more true than the one that originally formed the belief.'
  },
  {
    id: 'firr-method', group: 'method', title: 'FIRR: Fully Integrated Responsive Reprogramming', pages: [165, 173],
    thesis: 'FIRR replaces triggered emotional reactions with a fully embodied chosen state—especially love—repeated until the new response becomes subconscious and automatic.',
    aliases: ['firr', 'fully integrated responsive reprogramming', 'trigger', 'embody love', 'automatic emotional response', 'three seconds'],
    quotePage: 166,
    quote: 'Because belief is crystallized emotion, a new belief cannot be established through intellectual agreement alone. It must be felt.'
  },
  {
    id: 'ultimate-power', group: 'outcome', title: 'True Power Is Emotional Insusceptibility', pages: [171, 173],
    thesis: 'Power is not control over people or circumstances but reducing the capacity of what lies beyond one’s control to determine one’s internal experience.',
    aliases: ['true power', 'emotional invulnerability', 'insusceptible', 'nothing can disturb', 'control others', 'external events'],
    quotePage: 173,
    quote: 'This is the ultimate power: not the power to control absolutely everything that happens, but the power to ensure that almost nothing beyond one’s control can determine the quality of one’s experience.'
  },
  {
    id: 'heaven-on-earth-enlightenment', group: 'outcome', title: 'Heaven on Earth and Enlightenment', pages: [174, 180],
    thesis: 'The optimal human state combines maximized emotional well-being, transcended desire, maximal oneness, freedom, and an already-effective strategy requiring no further innovation.',
    aliases: ['heaven on earth', 'enlightenment', 'transcend desire', 'desirelessness', 'complete state', 'optimal human existence'],
    quotePage: 180,
    quote: 'These conditions together constitute the optimal state of human existence: Heaven on Earth.'
  }
];

const GROUPS = [
  { id: 'foundation', label: 'The Game & Objective' },
  { id: 'rule', label: 'The Fourteen Rules' },
  { id: 'mechanism', label: 'Core Mechanisms' },
  { id: 'metaphysics', label: 'Metaphysics & Purpose' },
  { id: 'method', label: 'Practical Change Methods' },
  { id: 'outcome', label: 'Power & The Complete State' }
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter(function (token) { return token.length > 2; });
}

function validate(pages) {
  const pageMap = new Map(pages.map(function (page) { return [page.page, normalize(page.text)]; }));
  const ids = new Set();
  const rules = new Set();
  CONCEPTS.forEach(function (concept) {
    if (ids.has(concept.id)) throw new Error('Duplicate Manual concept id: ' + concept.id);
    ids.add(concept.id);
    if (!pageMap.has(concept.quotePage)) throw new Error('Missing Manual page ' + concept.quotePage + ' for ' + concept.id);
    if (pageMap.get(concept.quotePage).indexOf(normalize(concept.quote)) === -1) {
      throw new Error('Unverified Manual quote for ' + concept.id + ' on page ' + concept.quotePage);
    }
    if (concept.rule) rules.add(concept.rule);
  });
  for (let rule = 1; rule <= 14; rule++) {
    if (!rules.has(rule)) throw new Error('Manual concept index is missing Rule ' + rule);
  }
  return true;
}

function publicIndex(pages) {
  validate(pages);
  return {
    version: 1,
    conceptCount: CONCEPTS.length,
    ruleCount: CONCEPTS.filter(function (concept) { return concept.rule; }).length,
    groups: GROUPS,
    workflow: {
      candidate: 'Compare a source statement against this compact concept map.',
      verify: 'For every candidate connection, return to the canonical manuscript page and quote before making a claim.',
      develop: 'Compare the source’s wording, assumptions, agreement, tension, extension, or contradiction with Harvey’s precise formulation.'
    },
    concepts: CONCEPTS
  };
}

function scoreConcept(concept, statement) {
  const source = normalize(statement);
  const sourceTokens = new Set(tokens(source));
  let score = 0;
  concept.aliases.forEach(function (alias) {
    const normalizedAlias = normalize(alias);
    if (source.indexOf(normalizedAlias) !== -1) score += normalizedAlias.indexOf(' ') === -1 ? 5 : 12;
  });
  tokens(concept.title).forEach(function (token) { if (sourceTokens.has(token)) score += 3; });
  tokens(concept.thesis).forEach(function (token) { if (sourceTokens.has(token)) score += 1; });
  return score;
}

function match(statement, pages, limit) {
  validate(pages);
  return CONCEPTS.map(function (concept) {
    return { concept: concept, score: scoreConcept(concept, statement) };
  }).filter(function (entry) { return entry.score > 0; })
    .sort(function (a, b) { return b.score - a.score || a.concept.quotePage - b.concept.quotePage; })
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 10)))
    .map(function (entry) { return Object.assign({ score: entry.score }, entry.concept); });
}

function promptText() {
  return CONCEPTS.map(function (concept) {
    return concept.title + ' (pp. ' + concept.pages.join('–') + '): ' + concept.thesis;
  }).join('\n');
}

module.exports = { CONCEPTS: CONCEPTS, GROUPS: GROUPS, validate: validate, publicIndex: publicIndex, match: match, promptText: promptText, normalize: normalize };
