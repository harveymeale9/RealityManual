'use strict';

const crypto = require('crypto');
const doctrine = require('./ideationDoctrine');

const INDEX_VERSION = 'semantic-fts-v4-exact-phrases';
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','do','does','for','from','had','has','have','how','i','if','in','is','it','me','my','of','on','or','our','should','so','that','the','their','there','they','this','to','was','we','what','when','where','which','who','why','will','with','you','your']);

const TOPICS = [
  { id: 'objective', label: 'the objective of life and emotional well-being', from: 9, to: 27, anchor: 14, triggers: ['objective','goal','goals','meaning of life','life worth living','success','wellbeing','well being','happiness','value'], terms: ['objective','emotional','wellbeing','value','experience','lifetime','strategy','outcome'] },
  { id: 'belief', label: 'belief, truth, meaning, and emotional experience', from: 28, to: 56, anchor: 32, triggers: ['belief','believe','truth','uncertain','uncertainty','meaning','interpretation','emotion','heaven','faith','evidence'], terms: ['belief','truth','meaning','interpretation','emotion','evidence','unknown','advantageous'] },
  { id: 'oneness', label: 'oneness, separation, love, and God', from: 57, to: 80, anchor: 57, triggers: ['oneness','separation','love','god','humanity','alien','aliens','extraterrestrial','ufo','unity','connection'], terms: ['oneness','separation','love','boundary','self','other','god','whole','unity'] },
  { id: 'purpose', label: 'purpose as function', from: 81, to: 85, anchor: 81, triggers: ['purpose','function','calling','reason i exist','existence'], terms: ['purpose','function','existence','nature','role','perform'] },
  { id: 'expansion', label: 'expansion and resistance to growth', from: 86, to: 88, anchor: 86, triggers: ['expansion','expand','growth','grow','stagnant','potential'], terms: ['expansion','infinite','growth','nature','resistance'] },
  { id: 'freedom', label: 'freedom and inner power', from: 89, to: 94, anchor: 89, triggers: ['freedom','power','powerful','control others','influence others','unshakeable','unshakable','external events','upset','reactive'], terms: ['freedom','power','control','action','desirable','external','emotional','constraint'] },
  { id: 'desire', label: 'desire and the source of positive or negative emotion', from: 95, to: 103, anchor: 95, triggers: ['desire','want','anxiety','stress','negative emotion','positive emotion','desireless','hell','relief'], terms: ['desire','fulfilled','unmet','emotion','anxiety','stress','relief','heaven','hell'] },
  { id: 'action', label: 'the subconscious mechanism of action', from: 104, to: 119, anchor: 109, triggers: ['action','act','discipline','procrastination','procrastinate','know i should','cant make myself','cannot make myself','unable to act','habit','behavior','subconscious action'], terms: ['action','subconscious','belief','behavior','intention','discipline','rewarding','alternative','possible'] },
  { id: 'motivation', label: 'motivation, resistance, and expected emotional reward', from: 120, to: 122, anchor: 120, triggers: ['motivation','motivated','resistance','incentive','drive','lazy','laziness'], terms: ['motivation','resistance','incentive','divergence','current','expected','emotional','action'] },
  { id: 'innovation', label: 'when life strategy should change', from: 123, to: 127, anchor: 123, triggers: ['innovation','change strategy','change my life','reinvent','stuck','strategy failing'], terms: ['innovation','strategy','change','wellbeing','effective','ineffective'] },
  { id: 'crystallized', label: 'how subconscious beliefs form from emotional experience', from: 128, to: 139, anchor: 128, triggers: ['trauma','conditioning','limiting belief','subconscious belief','belief formed','childhood','emotional memory','crystallized'], terms: ['subconscious','belief','crystallized','emotion','experience','record','automatic','formed'] },
  { id: 'panacea', label: 'the Panacea Process and triple alignment', from: 140, to: 164, anchor: 140, triggers: ['panacea','triple alignment','alignment','change belief','reprogram belief','dissolve desire','fulfil desire','fulfill desire'], terms: ['panacea','alignment','desire','action','belief','subconscious','transform','process','dissolution'] },
  { id: 'firr', label: 'FIRR and automatic emotional reprogramming', from: 165, to: 175, anchor: 165, triggers: ['firr','reprogram','automatic response','emotional response','autopilot','triggered','trigger'], terms: ['firr','integrated','responsive','reprogramming','automatic','response','emotion','subconscious'] },
  { id: 'enlightenment', label: 'enlightenment, desirelessness, and oneness', from: 176, to: 180, anchor: 176, triggers: ['enlightenment','enlightened','transcend desire','desirelessness','heaven on earth'], terms: ['enlightenment','transcendence','desire','oneness','existence','wellbeing','heaven'] }
];

const NUMBER_WORDS = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen'];
const RULE_REFERENCES = doctrine.RULES.map(function (rule, index) {
  const canonicalName = rule[0] === 'X' ? 'The Tripartite Rule' : 'The Rule of ' + rule[1];
  return {
    number: index + 1,
    roman: rule[0],
    shortName: rule[1],
    canonicalName: canonicalName,
    title: 'Rule ' + rule[0] + ': ' + canonicalName,
    description: rule[2],
    page: rule[3]
  };
});

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function phraseTokens(value) {
  return normalized(value).split(/\s+/).filter(Boolean);
}

function terms(value) {
  return phraseTokens(value).filter(function (term) { return term.length > 1 && !STOP_WORDS.has(term); });
}

// Find a genuinely verbatim sequence while ignoring typography and punctuation
// differences (smart quotes, em dashes, well-being vs. well being, etc.). Keep
// offsets into the original text so the result excerpt remains selectable and
// can be highlighted when the reader opens the page.
function exactPhraseExcerpt(text, query) {
  const wanted = phraseTokens(query);
  if (wanted.length < 2) return null;
  const source = String(text || '');
  const tokens = [];
  const pattern = /[a-z0-9]+(?:[’'][a-z0-9]+)*/gi;
  let match;
  while ((match = pattern.exec(source))) {
    tokens.push({ value: normalized(match[0]), start: match.index, end: pattern.lastIndex });
  }
  outer: for (let i = 0; i <= tokens.length - wanted.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (tokens[i + j].value !== wanted[j]) continue outer;
    }
    const start = tokens[i].start;
    const end = tokens[i + wanted.length - 1].end;
    let excerptStart = source.lastIndexOf('\n\n', start);
    excerptStart = excerptStart === -1 ? 0 : excerptStart + 2;
    let excerptEnd = source.indexOf('\n\n', end);
    excerptEnd = excerptEnd === -1 ? source.length : excerptEnd;
    const paragraphStart = excerptStart;
    const paragraphEnd = excerptEnd;
    if (excerptEnd - excerptStart > 500) {
      const room = Math.max(0, 500 - (end - start));
      excerptStart = Math.max(excerptStart, start - Math.floor(room / 2));
      excerptEnd = Math.min(source.length, Math.max(end, excerptStart + 500));
      if (excerptEnd - excerptStart > 500) excerptStart = excerptEnd - 500;
      if (excerptStart > paragraphStart && /\S/.test(source.charAt(excerptStart - 1))) {
        const nextSpace = source.slice(excerptStart, start).search(/\s/);
        if (nextSpace !== -1) excerptStart += nextSpace + 1;
      }
      if (excerptEnd < paragraphEnd && /\S/.test(source.charAt(excerptEnd))) {
        const priorSpace = source.slice(end, excerptEnd).search(/\s(?=\S*$)/);
        if (priorSpace !== -1) excerptEnd = end + priorSpace;
      }
    }
    return source.slice(excerptStart, excerptEnd).trim();
  }
  return null;
}

function titleFor(page) {
  const line = String(page.text || '').split('\n').map(function (value) { return value.trim(); }).find(function (value) {
    return value && value.length < 150 && /^(?:Section\b|[IVXLCDM]+\.\s|Rule\b|The\s+(?:Rule|Tripartite|Panacea|FIRR)\b)/i.test(value);
  });
  return line ? line.replace(/^Section\s+[IVXLCDM]+\s*[-:]?\s*/i, '') : 'Page ' + page.page;
}

function chunksFor(page) {
  const paragraphs = String(page.text || '').split(/\n\s*\n/).map(function (part) { return part.trim(); }).filter(function (part) { return part.length > 30; });
  return paragraphs.length ? paragraphs : [String(page.text || '').trim()];
}

function fingerprint(pages) {
  const hash = crypto.createHash('sha256');
  hash.update(INDEX_VERSION);
  pages.forEach(function (page) { hash.update(String(page.page)); hash.update('\0'); hash.update(page.text); hash.update('\0'); });
  return hash.digest('hex');
}

function matchingTopics(query) {
  const source = normalized(query);
  const matches = TOPICS.filter(function (topic) {
    return topic.triggers.some(function (trigger) { return source.indexOf(normalized(trigger)) !== -1; });
  });
  // Long natural-language searches often describe freedom without using the
  // noun itself: directing one's finite time/actions toward desires instead of
  // spending them avoiding worse outcomes. Recognize the relationship, not
  // merely the literal keyword.
  const desireDirectedAction = /\b(?:desir\w*|want\w*|prefer\w*)\b/.test(source)
    && /\b(?:act\w*|time|hours?|life)\b/.test(source)
    && /\b(?:orient\w*|toward\w*|avoid\w*|prevent\w*|compel\w*|money|financial)\b/.test(source);
  const freedom = TOPICS.find(function (topic) { return topic.id === 'freedom'; });
  if (desireDirectedAction && freedom && matches.indexOf(freedom) === -1) matches.push(freedom);
  return matches;
}

function matchingRule(query) {
  const source = normalized(query);
  const numbered = source.match(/\brule\s*(14|13|12|11|10|[1-9]|xiv|xiii|xii|xi|ix|viii|vii|vi|iv|iii|ii|x|v|i)\b/i);
  if (numbered) {
    const token = numbered[1].toUpperCase();
    const numeric = /^\d+$/.test(token) ? Number(token) : null;
    return RULE_REFERENCES.find(function (rule) { return numeric ? rule.number === numeric : rule.roman === token; }) || null;
  }
  for (let i = 0; i < NUMBER_WORDS.length; i++) {
    if (new RegExp('\\brule\\s+' + NUMBER_WORDS[i] + '\\b').test(source)) return RULE_REFERENCES[i];
  }
  return RULE_REFERENCES.find(function (rule) {
    const shortName = normalized(rule.shortName);
    return source.indexOf(normalized(rule.canonicalName)) !== -1
      || source === shortName
      || (source.indexOf('rule') !== -1 && source.indexOf(shortName) !== -1);
  }) || null;
}

function intentAnchors(query) {
  const source = normalized(query);
  const anchors = [];
  function add(page, conditions) {
    if (conditions.every(function (condition) { return source.indexOf(condition) !== -1; })) anchors.push(page);
  }
  add(14, ['objective']);
  add(66, ['love', 'defin']);
  add(81, ['purpose', 'function']);
  if (source.indexOf('power') !== -1 || source.indexOf('external events') !== -1) anchors.push(89);
  if (/\b(?:desir\w*|want\w*|prefer\w*)\b/.test(source)
      && /\b(?:act\w*|time|hours?|life)\b/.test(source)
      && /\b(?:orient\w*|toward\w*|avoid\w*|prevent\w*|compel\w*|money|financial)\b/.test(source)) anchors.push(91);
  if (source.indexOf('alien') !== -1 || source.indexOf('ufo') !== -1 || source.indexOf('extraterrestrial') !== -1) anchors.push(57);
  if ((source.indexOf('know i should') !== -1 || source.indexOf('conscious intention') !== -1 || source.indexOf('discipline') !== -1) && source.indexOf('action') !== -1) anchors.push(110);
  if ((source.indexOf('change') !== -1 || source.indexOf('reprogram') !== -1) && (source.indexOf('automatic') !== -1 || source.indexOf('response') !== -1 || source.indexOf('trigger') !== -1)) anchors.push(165);
  return anchors;
}

function setup(db, pages) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manuscript_search_index_meta (
      id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, built_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS manuscript_search_chunks USING fts5(
      chunk_id UNINDEXED, page UNINDEXED, title, body, semantic_terms,
      tokenize='porter unicode61'
    );
  `);
  const expected = fingerprint(pages);
  const current = db.prepare('SELECT fingerprint FROM manuscript_search_index_meta WHERE id=1').get();
  if (!current || current.fingerprint !== expected) {
    const insert = db.prepare('INSERT INTO manuscript_search_chunks (chunk_id,page,title,body,semantic_terms) VALUES (?,?,?,?,?)');
    db.transaction(function () {
      db.prepare('DELETE FROM manuscript_search_chunks').run();
      pages.forEach(function (page) {
        const title = titleFor(page);
        const semantic = TOPICS.filter(function (topic) { return page.page >= topic.from && page.page <= topic.to; })
          .map(function (topic) { return topic.label + ' ' + topic.terms.join(' '); }).join(' ');
        chunksFor(page).forEach(function (body, index) {
          insert.run(page.page + ':' + index, page.page, title, body, semantic);
        });
      });
      db.prepare('INSERT INTO manuscript_search_index_meta (id,fingerprint,built_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,built_at=excluded.built_at')
        .run(expected, new Date().toISOString());
    })();
  }

  const lookup = db.prepare(`SELECT page,title,body,bm25(manuscript_search_chunks,0,0,3.2,1.5,0.55) AS rank
    FROM manuscript_search_chunks WHERE manuscript_search_chunks MATCH ? ORDER BY rank LIMIT 80`);
  const pageLookup = db.prepare('SELECT page,title,body,0 AS rank FROM manuscript_search_chunks WHERE page=?');

  function search(query) {
    const queryTerms = terms(query);
    const topics = matchingTopics(query);
    const rule = matchingRule(query);
    const anchors = intentAnchors(query).concat(rule ? [rule.page] : []);
    const ruleTerms = rule ? terms(rule.canonicalName + ' ' + rule.description) : [];
    const expanded = queryTerms.concat(ruleTerms, topics.flatMap(function (topic) { return topic.terms; }));
    const unique = Array.from(new Set(expanded)).slice(0, 32);
    const exactRows = pages.map(function (page) {
      const excerpt = exactPhraseExcerpt(page.text, query);
      return excerpt ? { page: page.page, title: titleFor(page), body: excerpt, rank: 0, exactPhrase: true } : null;
    }).filter(Boolean);
    if (!unique.length && !exactRows.length) return [];
    const match = unique.map(function (term) { return '"' + term + '"*'; }).join(' OR ');
    // FTS deliberately caps its broad candidate set. Always inject semantic
    // intent anchors as candidates too, otherwise a long query full of common
    // words can identify the right concept yet have its canonical page dropped
    // before the reranker ever sees it.
    const anchorRows = anchors.flatMap(function (page) { return pageLookup.all(page); });
    const rows = (match ? lookup.all(match) : []).concat(exactRows, anchorRows, rule ? pageLookup.all(rule.page) : []);
    const byPage = new Map();
    rows.forEach(function (row) {
      const page = Number(row.page);
      const bodyTerms = new Set(terms(row.body + ' ' + row.title));
      const lexical = queryTerms.reduce(function (score, term) { return score + (bodyTerms.has(term) ? 5 : 0); }, 0);
      const topicBoost = topics.reduce(function (score, topic) {
        if (page < topic.from || page > topic.to) return score;
        return score + 28 + Math.max(0, 8 - Math.abs(page - topic.anchor));
      }, 0);
      const phraseBoost = row.exactPhrase ? 4000 : 0;
      const anchorBoost = anchors.reduce(function (score, anchor) {
        const distance = Math.abs(page - anchor);
        return score + (distance === 0 ? 100 : distance <= 2 ? 45 - distance * 10 : 0);
      }, 0);
      const ruleBoost = rule && page === rule.page ? 2000 : 0;
      const score = -Number(row.rank || 0) + lexical + topicBoost + phraseBoost + anchorBoost + ruleBoost;
      const prior = byPage.get(page);
      if (!prior || score > prior.score) byPage.set(page, Object.assign({}, row, { page: page, score: score }));
    });
    return Array.from(byPage.values()).sort(function (a, b) { return b.score - a.score; }).slice(0, 8).map(function (row) {
      const topic = topics.find(function (candidate) { return row.page >= candidate.from && row.page <= candidate.to; });
      const exactRule = rule && row.page === rule.page;
      const exactPhrase = !!row.exactPhrase;
      const body = row.body.length > 500 ? row.body.slice(0, 500).replace(/\s+\S*$/, '') : row.body;
      return {
        page: row.page,
        title: exactRule ? rule.title : (row.title === 'Page ' + row.page && topic ? topic.label : row.title),
        relevance: exactRule
          ? 'This is ' + rule.title + ', the exact Rule requested.'
          : exactPhrase
          ? 'This passage contains the exact phrase from your search.'
          : topic
          ? 'This passage is a strong match for your search through the Manual’s discussion of ' + topic.label + '.'
          : 'This passage contains the closest indexed match to the meaning and language of your search.',
        excerpt: body,
        score: Math.round(row.score * 100) / 100
      };
    });
  }

  return { search: search, fingerprint: expected, topicCount: TOPICS.length };
}

module.exports = { setup: setup, matchingTopics: matchingTopics, matchingRule: matchingRule, intentAnchors: intentAnchors, exactPhraseExcerpt: exactPhraseExcerpt, normalized: normalized, terms: terms, TOPICS: TOPICS, RULE_REFERENCES: RULE_REFERENCES };
