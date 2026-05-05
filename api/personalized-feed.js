import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Fuzzy match: checks if two topic strings are meaningfully the same.
 * Handles common cases like "AI" vs "artificial intelligence",
 * "F1" vs "formula 1", "NBA" vs "basketball", etc.
 *
 * Strategy: if either string contains the other as a word/substring,
 * count it as a match. This is intentionally broad — false positives
 * are fine; false negatives (missing a match) are the real problem.
 */
const TOPIC_ALIASES = {
  'ai': ['artificial intelligence', 'machine learning', 'deep learning', 'llm', 'generative ai'],
  'artificial intelligence': ['ai', 'machine learning', 'deep learning', 'llm', 'generative ai'],
  'machine learning': ['ai', 'artificial intelligence'],
  'f1': ['formula 1', 'formula one', 'grand prix'],
  'formula 1': ['f1', 'formula one', 'grand prix'],
  'formula one': ['f1', 'formula 1', 'grand prix'],
  'nba': ['basketball', 'nba basketball'],
  'basketball': ['nba'],
  'nfl': ['american football', 'football', 'nfl football'],
  'soccer': ['football', 'epl', 'premier league', 'champions league', 'la liga'],
  'football': ['nfl', 'soccer', 'premier league'],
  'premier league': ['soccer', 'football', 'epl'],
  'epl': ['premier league', 'soccer', 'football'],
  'stock market': ['stocks', 'equities', 'trading', 'wall street', 'finance'],
  'finance': ['stock market', 'stocks', 'economics', 'economy'],
  'economics': ['economy', 'finance'],
  'economy': ['economics', 'finance'],
  'climate': ['climate change', 'global warming', 'environment'],
  'environment': ['climate', 'climate change', 'sustainability'],
  'climate change': ['climate', 'environment', 'global warming'],
  'crypto': ['cryptocurrency', 'bitcoin', 'ethereum', 'blockchain'],
  'cryptocurrency': ['crypto', 'bitcoin', 'ethereum', 'blockchain'],
  'bitcoin': ['crypto', 'cryptocurrency'],
  'space': ['nasa', 'spacex', 'astronomy', 'cosmology'],
  'nasa': ['space'],
  'spacex': ['space'],
  'k-pop': ['kpop', 'korean pop', 'k pop'],
  'kpop': ['k-pop', 'korean pop'],
  'gaming': ['video games', 'esports', 'game'],
  'video games': ['gaming', 'esports'],
};

function topicsMatch(prefTopic, articleTopic) {
  const p = normalize(prefTopic);
  const a = normalize(articleTopic);

  // Exact match
  if (p === a) return true;

  // One contains the other (e.g. "technology" matches "information technology")
  if (a.includes(p) || p.includes(a)) return true;

  // Alias lookup in both directions
  const aliasesForPref = TOPIC_ALIASES[p] || [];
  if (aliasesForPref.includes(a)) return true;

  const aliasesForArticle = TOPIC_ALIASES[a] || [];
  if (aliasesForArticle.includes(p)) return true;

  return false;
}

function articleMatchesBlockedTopic(article, blockedTopics) {
  const articleTopics = (article.topics || []).map(normalize);
  for (const blocked of blockedTopics) {
    if (articleTopics.some(at => topicsMatch(blocked, at))) return true;
  }
  return false;
}

function scoreArticle(article, topicScores, sourceScores, hasPreferences) {
  let score = 0;
  const reasons = [];

  const source = normalize(article.source);
  const articleTopics = (article.topics || []).map(normalize);

  // Topic scoring — fuzzy match against all user preference topics
  for (const [prefTopic, prefScore] of topicScores.entries()) {
    for (const articleTopic of articleTopics) {
      if (topicsMatch(prefTopic, articleTopic)) {
        score += prefScore * 10;
        reasons.push(`Topic match: "${prefTopic}" ~ "${articleTopic}" (${prefScore > 0 ? '+' : ''}${prefScore})`);
        break; // Only count each pref topic once per article
      }
    }
  }

  // Source scoring
  const sourceScore = sourceScores.get(source) || 0;
  if (sourceScore !== 0) {
    score += sourceScore * 5;
    reasons.push(`Source "${article.source}": ${sourceScore > 0 ? '+' : ''}${sourceScore}`);
  }

  // Freshness boost
  if (article.publish_date) {
    const ageHours = (Date.now() - new Date(article.publish_date).getTime()) / 36e5;
    if (ageHours <= 6) {
      score += 3;
      reasons.push('Very fresh (<6h)');
    } else if (ageHours <= 24) {
      score += 2;
      reasons.push('Fresh (<24h)');
    } else if (ageHours <= 72) {
      score += 1;
      reasons.push('Recent (<72h)');
    }
  }

  // Generic penalty — only apply if user has preferences (otherwise everything gets penalised equally)
  if (hasPreferences && (!articleTopics.length || articleTopics.includes('news'))) {
    score -= 2;
    reasons.push('Generic article penalty');
  }

  return {
    ...article,
    relevance_score: Number(score.toFixed(2)),
    relevance_reasons: reasons,
  };
}

export default async function handler(req, res) {
  try {
    const userId = req.query.user_id;
    const page = Number(req.query.page || 0);
    const pageSize = Number(req.query.page_size || 10);

    if (!userId) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    // Load user preferences
    const { data: prefs, error: prefsError } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId);

    if (prefsError) {
      return res.status(500).json({ error: prefsError.message });
    }

    const topicScores = new Map();
    const sourceScores = new Map();
    const blockedTopics = new Set();
    const blockedSources = new Set();

    for (const pref of prefs || []) {
      if (pref.topic) {
        const topic = normalize(pref.topic);
        topicScores.set(topic, pref.preference_score || 0);
        if ((pref.preference_score || 0) <= -1) blockedTopics.add(topic);
      }
      if (pref.source) {
        const source = normalize(pref.source);
        sourceScores.set(source, pref.preference_score || 0);
        if ((pref.preference_score || 0) <= -1) blockedSources.add(source);
      }
    }

    const hasPreferences = topicScores.size > 0 || sourceScores.size > 0;

    // Pull a broad candidate pool
    const { data: articles, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (articleError) {
      return res.status(500).json({ error: articleError.message });
    }

    // Filter blocked sources and topics
    const filtered = (articles || []).filter(article => {
      const source = normalize(article.source);
      if (blockedSources.has(source)) return false;
      if (articleMatchesBlockedTopic(article, blockedTopics)) return false;
      return true;
    });

    // Score and sort
    const scored = filtered
      .map(article => scoreArticle(article, topicScores, sourceScores, hasPreferences))
      .sort((a, b) => {
        if (b.relevance_score !== a.relevance_score) {
          return b.relevance_score - a.relevance_score;
        }
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });

    const from = page * pageSize;
    const to = from + pageSize;
    const paged = scored.slice(from, to);

    return res.status(200).json({
      articles: paged,
      total_candidates: scored.length,
      has_preferences: hasPreferences,
      topic_count: topicScores.size,
      page,
      page_size: pageSize,
      has_more: to < scored.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}