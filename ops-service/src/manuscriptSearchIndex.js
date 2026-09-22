'use strict';

const crypto = require('crypto');

const INDEX_VERSION = 'semantic-fts-v1';
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

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function terms(value) {
  return normalized(value).split(/\s+/).filter(function (term) { return term.length > 1 && !STOP_WORDS.has(term); });
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
  return TOPICS.filter(function (topic) {
    return topic.triggers.some(function (trigger) { return source.indexOf(normalized(trigger)) !== -1; });
  });
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

  function search(query) {
    const queryTerms = terms(query);
    const topics = matchingTopics(query);
    const expanded = queryTerms.concat(topics.flatMap(function (topic) { return topic.terms; }));
    const unique = Array.from(new Set(expanded)).slice(0, 32);
    if (!unique.length) return [];
    const match = unique.map(function (term) { return '"' + term + '"*'; }).join(' OR ');
    const rows = lookup.all(match);
    const byPage = new Map();
    rows.forEach(function (row) {
      const page = Number(row.page);
      const bodyTerms = new Set(terms(row.body + ' ' + row.title));
      const lexical = queryTerms.reduce(function (score, term) { return score + (bodyTerms.has(term) ? 5 : 0); }, 0);
      const topicBoost = topics.reduce(function (score, topic) {
        if (page < topic.from || page > topic.to) return score;
        return score + 28 + Math.max(0, 8 - Math.abs(page - topic.anchor));
      }, 0);
      const phraseBoost = normalized(row.body).indexOf(normalized(query)) !== -1 ? 80 : 0;
      const score = -Number(row.rank || 0) + lexical + topicBoost + phraseBoost;
      const prior = byPage.get(page);
      if (!prior || score > prior.score) byPage.set(page, Object.assign({}, row, { page: page, score: score }));
    });
    return Array.from(byPage.values()).sort(function (a, b) { return b.score - a.score; }).slice(0, 8).map(function (row) {
      const topic = topics.find(function (candidate) { return row.page >= candidate.from && row.page <= candidate.to; });
      const body = row.body.length > 500 ? row.body.slice(0, 500).replace(/\s+\S*$/, '') : row.body;
      return {
        page: row.page,
        title: row.title === 'Page ' + row.page && topic ? topic.label : row.title,
        relevance: topic
          ? 'This passage is a strong match for your search through the Manual’s discussion of ' + topic.label + '.'
          : 'This passage contains the closest indexed match to the meaning and language of your search.',
        excerpt: body,
        score: Math.round(row.score * 100) / 100
      };
    });
  }

  return { search: search, fingerprint: expected, topicCount: TOPICS.length };
}

module.exports = { setup: setup, matchingTopics: matchingTopics, normalized: normalized, terms: terms, TOPICS: TOPICS };
