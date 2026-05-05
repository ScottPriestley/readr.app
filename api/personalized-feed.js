import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function articleMatchesBlockedTopic(article, blockedTopics) {
  const articleTopics = (article.topics || []).map(normalize);
  return articleTopics.some(topic => blockedTopics.has(topic));
}

function scoreArticle(article, topicScores, sourceScores) {
  let score = 0;
  const reasons = [];

  const source = normalize(article.source);
  const topics = (article.topics || []).map(normalize);

  for (const topic of topics) {
    const topicScore = topicScores.get(topic) || 0;
    if (topicScore > 0) {
      score += topicScore * 10;
      reasons.push(`Matched topic: ${topic}`);
    }
    if (topicScore < 0) {
      score += topicScore * 10;
      reasons.push(`Negative topic preference: ${topic}`);
    }
  }

  const sourceScore = sourceScores.get(source) || 0;
  if (sourceScore > 0) {
    score += sourceScore * 5;
    reasons.push(`Preferred source: ${article.source}`);
  }
  if (sourceScore < 0) {
    score += sourceScore * 5;
    reasons.push(`Lower-ranked source: ${article.source}`);
  }

  // Freshness boost: newer articles get a small advantage.
  if (article.publish_date) {
    const ageHours = (Date.now() - new Date(article.publish_date).getTime()) / 36e5;
    if (ageHours <= 24) {
      score += 2;
      reasons.push('Fresh article');
    } else if (ageHours <= 72) {
      score += 1;
      reasons.push('Recent article');
    }
  }

  // Generic fallback penalty.
  if (!topics.length || topics.includes('news')) {
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

    // Pull a larger candidate pool first.
    // This is the key change: we score a broad set before choosing what to show.
    const { data: articles, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (articleError) {
      return res.status(500).json({ error: articleError.message });
    }

    const filtered = (articles || []).filter(article => {
      const source = normalize(article.source);
      if (blockedSources.has(source)) return false;
      if (articleMatchesBlockedTopic(article, blockedTopics)) return false;
      return true;
    });

    const scored = filtered
      .map(article => scoreArticle(article, topicScores, sourceScores))
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
      page,
      page_size: pageSize,
      has_more: to < scored.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}