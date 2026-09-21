'use strict';

// This method was reverse-engineered from the completed manuscript and all 31
// Outline Completed cards present on 2026-09-21. It describes the transferable
// reasoning moves in Harvey's strongest premises without feeding finished
// scripts back to the provider or encouraging it to imitate their wording.
const METHOD = `BIG IDEA METHOD — DERIVE, DO NOT SUMMARIZE

A topic is a subject (procrastination, love, income, enlightenment). A manuscript concept is a teaching (subconscious action, oneness, internal value). Neither is yet a Big Idea. A Big Idea is a defensible editorial claim produced by applying manuscript machinery to a recognizable situation in a way that changes how someone understands or handles it.

Use this underlying formula:
RECOGNIZABLE SITUATION + HIDDEN/DEFAULT ASSUMPTION + MANUSCRIPT MECHANISM + NON-OBVIOUS LOGICAL TURN + STRATEGIC CONSEQUENCE + EWB STAKES.

Derive it in this order:
1. Begin with a live human tension: a worry, desire, repeated failure, culturally accepted piece of advice, philosophical question, current behavior, or concrete decision. It must be specific enough that a person can recognize themselves in it.
2. State the default model or unnoticed assumption that makes the situation confusing. Do not invent a straw man; use something people plausibly believe or do.
3. Select the smallest sufficient set of manuscript primitives—usually one Rule, sometimes two or three whose interaction creates the insight. Preserve the manuscript's definitions precisely.
4. Build an explicit because/therefore chain. Every step must follow from the previous one. The surprising conclusion must be derived, not asserted, and must remain true when the rhetoric is removed.
5. Cash out the consequence: what should the reader now notice, stop doing, do differently, or optimize? Explain why the old model costs EWB or why the new model improves it.
6. Express only the premise. Leave hooks, titles, scripts, ordered beats, and production choices to Harvey.

Use one or more of these proven idea operators:
- REDEFINE: reveal what a familiar thing actually is in the Manual's model. Examples of the move include product value becoming emotional transformation, a problem becoming its negative emotional output, or freedom becoming the ability to act on desire.
- INVERT: show why accepted advice or moral framing is strategically backward. Examples of the move include discipline as inefficient force, self-sacrifice as compatible with self-interest through oneness, or suffering as undesirable without being illegitimate.
- COMPRESS: reduce many apparently different cases to a small causal model. Examples of the move include two reasons action stops, two ways desire ends, or five axes through which life improves.
- TRANSFER: apply a Rule faithfully to a domain where readers would not expect it—money, sales, dating, social behavior, technology, or a speculative edge case. The connection must reveal a useful implication, not merely decorate the topic with book language.
- SYNTHESIZE: combine Rules so their interaction yields a conclusion not stated by either alone. The completed enlightenment work, for example, connects desire, motivation, innovation, freedom, expansion, and oneness to predict what an enlightened life would actually look like.
- EXTREMIZE: test a principle at a boundary case to expose its structure: zero desire, total separation, perfect EWB, death, an alien civilization, or an impossible objective. Bring the result back to ordinary life.
- DIAGNOSE: reinterpret a visible symptom as the output of a hidden mechanism, then identify the actual leverage point. Procrastination becomes a subconscious desirability/trajectory veto rather than laziness; anxiety becomes costly gameplay before the feared event has even occurred.
- RESOLVE AN OBJECTION: take the strongest plausible objection to a central claim, identify the category error or hidden premise beneath it, and show why the doctrine still holds. A weak objection produces a weak idea.

Patterns demonstrated across the completed outlines:
- Start in the audience's world, not in the book. The book supplies the explanatory machinery.
- Prefer a precise mechanism over inspirational advice. Name what causes the behavior or emotional result.
- Separate outputs from inputs and ends from proxies. Happiness is an output; action and belief are inputs. Money, status, purpose, products, and goals are often proxies for expected emotional change.
- Look for category errors: confusing physical proximity with oneness, conscious intention with bodily control, unpleasant experience with failed purpose, preference with intense desire, fact with interpretation, or fulfilment with dissolution.
- Follow implications farther than the manuscript's headline claim. The strongest completed outlines often ask, "If this Rule is true, what else must also be true?"
- Use concrete examples as proof of the mechanism, not as the premise itself.
- Preserve nuance and boundary conditions. A sharp claim is not permission to overstate what the Rule establishes.
- Make the cost of misunderstanding visible across time. The best stakes are often a wasted decade, persistent unmet desire, needless negative emotion, unfreedom, or an entire strategy optimized for the wrong outcome.
- End at a decision, diagnostic, or strategic lens. Mere surprise is not enough.

Silent quality gate for every candidate (0–5 each):
1. Human relevance: is the entry situation recognizable and consequential?
2. Non-obviousness: does it make a real logical turn beyond manuscript summary?
3. Manuscript specificity: could this premise only come from this book's machinery?
4. Derivational rigor: does every step in the because/therefore chain hold?
5. Strategic usefulness: does it change a decision, diagnosis, or behavior?
6. EWB stakes: is the emotional cost or benefit concrete?
7. Distinctiveness: is it materially different from the existing catalog?

Reject any candidate below 4 on non-obviousness, derivational rigor, or strategic usefulness, or below 27/35 overall. Also reject any premise that is merely a Rule restatement, a chapter summary, generic self-help advice, a provocative claim without a mechanism, or an existing outline with different nouns.`;

function promptText() { return METHOD; }

module.exports = { METHOD: METHOD, promptText: promptText };
