'use strict';

// Harvey's preferred Big Idea method, reverse-engineered from his own concise
// reductions of completed outlines #022, #028, #034, and #035. Keep this
// deliberately simple: the previous multi-operator framework encouraged
// clever micro-applications instead of the broad conceptual reframes he wants.
const METHOD = `HARVEY'S BIG IDEA METHOD — FIND THE SIMPLE REFRAME

The goal is not to invent a detailed content premise, a niche life scenario, a clever application, or a miniature script. The goal is to extract one simple, powerful thought from the manuscript that changes how people understand something they already care or talk about.

THE FORMULA

1. Start with a familiar subject, question, assumption, or public conversation that already has broad human interest: discipline, power, business, selling, success, love, God, suffering, procrastination, UFOs, happiness, motivation, purpose, and so on.
2. Find the manuscript principle that reveals the conventional understanding of that subject to be incomplete, incorrectly framed, or aimed at the wrong thing.
3. State the replacement frame in one clean claim: "It is not really X; it is Y," "The wrong question is X; the useful question is Y," or "People assume X, but the named Rule implies Z."
4. Give only the shortest causal explanation required to make the claim intelligible and defensible.

In compact form:
FAMILIAR SUBJECT OR QUESTION → MANUSCRIPT-BASED REFRAME → MINIMUM NECESSARY REASON.

The reframe is the Big Idea. Everything else belongs in the eventual outline.

CANONICAL STYLE EXAMPLES, REDUCED BY HARVEY FROM HIS COMPLETED OUTLINES

#022, The Relevant Question:
Whenever someone struggles to do what they know they should do, it is never a question of why they lack sufficient discipline. That is the wrong question. The Rule of Subconscious Action tells us it is a physical impossibility to act unless the subconscious holds a compatible belief. The useful question is: what belief in my subconscious is preventing my ability to act?

#035, The Most Powerful People Have Mastered This:
Power is not the ability to control or influence others. True power is being insusceptible to events in external reality that would normally cause upset.

#034, Understand This & You Can Sell Anything:
No business is actually selling products or services. Those are proxies for what the customer is truly purchasing: an emotional transformation.

#028, Why A Super-intelligent Alien Race Would Never Invade Or Harm Humanity:
With all the discussion about UFOs and disclosure, should humanity fear a super-advanced extraterrestrial race? No. A genuinely superintelligent civilization would understand and practice the Rule of Oneness.

WHAT THESE EXAMPLES HAVE IN COMMON

- Each contains ONE idea that can be understood immediately.
- Each starts from an existing concept or conversation, not a contrived anecdote.
- Each makes a bold, broadly relevant claim.
- Each changes the definition, question, or governing frame.
- The manuscript provides the reason the new frame is true.
- The explanation stops as soon as the idea clicks. It does not pre-write the outline.
- The premise leaves Harvey ample room to develop examples, proof, qualifications, and strategy himself.

WHAT NOT TO GENERATE

- Do not hunt for narrow domestic or lifestyle scenarios such as unwanted gifts, one missed workout, an unfinished task list, a pay rise funding subscriptions, guilt while resting, or arguments on social media unless Harvey has explicitly supplied one as the subject.
- Do not combine six conceptual moves into an intricate thesis.
- Do not turn the idea into advice, a therapeutic intervention, a list of steps, or an ordered argument.
- Do not mistake specificity for quality. The desired ideas are often broad and elemental.
- Do not pad a simple reframe with consequences, caveats, examples, or rhetorical decoration.
- Do not merely summarize a Rule. The Rule must alter how a familiar subject is understood.
- Do not imitate the topics above. Imitate their simplicity and type of reasoning.

LENGTH

Most Big Ideas should be one to three concise sentences. A premise that clearly calls for long-form treatment may use up to six sentences, but only when the core reframe genuinely needs a longer logical bridge. Length must come from necessary reasoning, never from outlining the future content.

FINAL TEST

Before returning an idea, ask:
1. Can the entire idea be repeated accurately in one breath?
2. Is there one obvious sentence that constitutes the reframe?
3. Does it concern something broadly recognizable without needing a contrived setup?
4. Does a specific manuscript principle make the reframe logically defensible?
5. Have all outline material, examples, advice, and extra cleverness been removed?

If any answer is no, simplify or discard it.`;

function promptText() { return METHOD; }

module.exports = { METHOD: METHOD, promptText: promptText };
