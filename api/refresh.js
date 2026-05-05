import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Tunables
const TOP_TOPIC_COUNT = 15;
const PER_TOPIC_PAGE_SIZE = 20;
const FALLBACK_PAGE_SIZE = 30;
const MIN_PREFERENCE_SCORE = 0.1;
const INFERENCE_BATCH_SIZE = 25;

// The same curated topics shown during onboarding — the canonical vocabulary.
// When the AI infers topics, it must prefer these exact strings where relevant.
const CURATED_TOPICS = [
  'technology', 'artificial intelligence', 'science', 'space', 'health',
  'politics', 'world news', 'business', 'finance', 'stock market',
  'sports', 'nfl', 'nba', 'soccer', 'formula 1',
  'climate', 'environment', 'entertainment', 'film', 'music',
  'gaming', 'food', 'travel', 'history', 'law & crime',
];

async function fetchJSON(url, label) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.error(`[${label}] HTTP ${res.status}: ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[${label}] fetch failed:`, err.message);
    return null;
  }
}

async function getTopUserTopics() {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('topic, preference_score')
    .not('topic', 'is', null)
    .gte('preference_score', MIN_PREFERENCE_SCORE);

  if (error) {
    console.error('Failed to fetch user preferences:', error.message);
    return [];
  }

  const topicScores = new Map();
  for (const row of data || []) {
    const current = topicScores.get(row.topic) || 0;
    topicScores.set(row.topic, current + row.preference_score);
  }

  return Array.from(topicScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TOPIC_COUNT)
    .map(([topic]) => topic);
}

/**
 * Get all unique topic strings that exist in user_preferences.
 * These are the freeform topics users typed during onboarding,
 * normalised by /api/normalise-topics. Together with CURATED_TOPICS
 * they form the full canonical vocabulary for inference.
 */
async function getUserPreferenceTopics() {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('topic')
    .not('topic', 'is', null)
    .gte('preference_score', MIN_PREFERENCE_SCORE);

  if (error) return [];

  const topics = new Set();
  for (const row of data || []) {
    if (row.topic) topics.add(row.topic);
  }
  return Array.from(topics);
}

function normalizeNewsAPIArticle(a) {
  return {
    url: a.url,
    title: a.title,
    summary: a.description || null,
    image_url: a.urlToImage || null,
    source: a.source?.name || 'Unknown',
    publish_date: a.publishedAt || null,
  };
}

function normalizeTheNewsAPIArticle(a) {
  return {
    url: a.url,
    title: a.title,
    summary: a.description || null,
    image_url: a.image_url || null,
    source: a.source || 'Unknown',
    publish_date: a.published_at || null,
  };
}

async function fetchNewsAPIByTopic(topic) {
  const q = encodeURIComponent(topic);
  const url = `https://newsapi.org/v2/everything?q=${q}&language=en&sortBy=publishedAt&pageSize=${PER_TOPIC_PAGE_SIZE}&apiKey=${process.env.NEWSAPI_KEY}`;
  const result = await fetchJSON(url, `NewsAPI:${topic}`);
  if (!result || result.status !== 'ok' || !Array.isArray(result.articles)) {
    if (result?.message) console.error(`[NewsAPI:${topic}] ${result.message}`);
    return [];
  }
  return result.articles.filter(a => a.url && a.title).map(normalizeNewsAPIArticle);
}

async function fetchNewsAPIBaseline() {
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=${FALLBACK_PAGE_SIZE}&apiKey=${process.env.NEWSAPI_KEY}`;
  const result = await fetchJSON(url, 'NewsAPI:baseline');
  if (!result || result.status !== 'ok' || !Array.isArray(result.articles)) {
    if (result?.message) console.error(`[NewsAPI:baseline] ${result.message}`);
    return [];
  }
  return result.articles.filter(a => a.url && a.title).map(normalizeNewsAPIArticle);
}

async function fetchTheNewsAPIByTopic(topic) {
  const q = encodeURIComponent(topic);
  const url = `https://api.thenewsapi.com/v1/news/all?api_token=${process.env.THENEWSAPI_KEY}&language=en&search=${q}&limit=${PER_TOPIC_PAGE_SIZE}`;
  const result = await fetchJSON(url, `TheNewsAPI:${topic}`);
  if (!result || !Array.isArray(result.data)) return [];
  return result.data.filter(a => a.url && a.title).map(normalizeTheNewsAPIArticle);
}

async function fetchTheNewsAPIBaseline() {
  const url = `https://api.thenewsapi.com/v1/news/top?api_token=${process.env.THENEWSAPI_KEY}&language=en&limit=${FALLBACK_PAGE_SIZE}`;
  const result = await fetchJSON(url, 'TheNewsAPI:baseline');
  if (!result || !Array.isArray(result.data)) return [];
  return result.data.filter(a => a.url && a.title).map(normalizeTheNewsAPIArticle);
}

/**
 * Classify a single batch of titles against the canonical vocabulary.
 * The key change: the prompt now tells the AI to prefer the exact strings
 * users have in their preferences, so inference output matches stored prefs.
 */
async function inferTopicsBatch(titles, batchLabel, canonicalTopics) {
  const vocabularyList = canonicalTopics.join(', ');

  const prompt = `You are a news topic classifier. For each article title, assign 2-3 topic tags.

IMPORTANT: You must use the canonical topic vocabulary below wherever it fits. Only invent a new tag if none of the canonical topics apply.

Canonical topics (use these exact strings):
${vocabularyList}

For each title, return the best matching canonical topics first. If a canonical topic clearly applies, you MUST use the exact canonical string (e.g. use "Artificial Intelligence" not "AI", use "Formula 1" not "F1", use "Stock Market" not "stocks").

Return ONLY a valid JSON object where each key is the exact article title and the value is an array of tag strings. No explanation, no markdown.

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,        // Zero temp = consistent, deterministic tag strings
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[inferTopics:${batchLabel}] OpenRouter HTTP ${response.status}: ${errBody.slice(0, 300)}`);
      return {};
    }

    const data = await response.json();

    if (data.error) {
      console.error(`[inferTopics:${batchLabel}] OpenRouter error:`, JSON.stringify(data.error));
      return {};
    }

    const text = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;

    if (!text) {
      console.error(`[inferTopics:${batchLabel}] No content. finish_reason: ${finishReason}`);
      return {};
    }

    if (finishReason !== 'stop') {
      console.warn(`[inferTopics:${batchLabel}] Non-stop finish_reason: ${finishReason} (output may be truncated)`);
    }

    try {
      const parsed = JSON.parse(text);
      console.log(`[inferTopics:${batchLabel}] OK — ${Object.keys(parsed).length}/${titles.length} titles classified`);
      return parsed;
    } catch (err) {
      console.error(`[inferTopics:${batchLabel}] Parse failed: ${err.message}`);
      console.error(`[inferTopics:${batchLabel}] Last 200 chars: ${text.slice(-200)}`);
      return {};
    }
  } catch (err) {
    console.error(`[inferTopics:${batchLabel}] Request threw:`, err.message);
    return {};
  }
}

/**
 * Classify all titles. Fetches the live user preference vocabulary
 * so inference always matches what users have actually selected.
 */
async function inferTopics(articles) {
  if (articles.length === 0) return {};

  // Build canonical vocabulary: curated topics + any freeform topics
  // users have added via onboarding. This is the single source of truth.
  const userTopics = await getUserPreferenceTopics();
  const canonicalTopics = [
    ...new Set([...CURATED_TOPICS, ...userTopics])
  ];

  console.log(`[inferTopics] Canonical vocabulary: ${canonicalTopics.length} topics`);

  const titles = articles.map(a => a.title).filter(Boolean);
  console.log(`[inferTopics] Classifying ${titles.length} titles in batches of ${INFERENCE_BATCH_SIZE}`);

  const batches = [];
  for (let i = 0; i < titles.length; i += INFERENCE_BATCH_SIZE) {
    batches.push(titles.slice(i, i + INFERENCE_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch, idx) =>
      inferTopicsBatch(batch, `${idx + 1}/${batches.length}`, canonicalTopics)
    )
  );

  const merged = {};
  for (const result of results) {
    Object.assign(merged, result);
  }

  console.log(`[inferTopics] Total: ${Object.keys(merged).length}/${titles.length} titles classified across ${batches.length} batches`);
  return merged;
}

export default async function handler(req, res) {
  try {
    const topUserTopics = await getTopUserTopics();
    console.log(`Top user topics (${topUserTopics.length}):`, topUserTopics);

    const topicFetches = topUserTopics.flatMap(topic => [
      fetchNewsAPIByTopic(topic),
      fetchTheNewsAPIByTopic(topic),
    ]);

    const baselineFetches = [
      fetchNewsAPIBaseline(),
      fetchTheNewsAPIBaseline(),
    ];

    const allResults = await Promise.all([...topicFetches, ...baselineFetches]);

    const seen = new Set();
    const allArticles = [];
    for (const batch of allResults) {
      for (const article of batch) {
        if (seen.has(article.url)) continue;
        seen.add(article.url);
        allArticles.push(article);
      }
    }

    if (allArticles.length === 0) {
      console.error('No articles fetched from any source — check API keys and endpoints');
      return res.status(500).json({ error: 'No articles fetched from any source' });
    }

    console.log(`Fetched ${allArticles.length} unique articles across ${topUserTopics.length} topics + baseline`);

    const topicMap = await inferTopics(allArticles);

    let inserted = 0;
    let failed = 0;
    let usedFallback = 0;
    for (const item of allArticles) {
      const inferred = topicMap[item.title];
      const topics = inferred || ['news'];
      if (!inferred) usedFallback++;
      const { error } = await supabase
        .from('articles')
        .upsert({ ...item, topics }, { onConflict: 'url', ignoreDuplicates: true });
      if (error) {
        failed++;
        console.error(`Upsert failed for ${item.url}:`, error.message);
      } else {
        inserted++;
      }
    }

    console.log(`Upsert summary: ${inserted} ok, ${failed} failed, ${usedFallback} used 'news' fallback`);

    res.status(200).json({
      success: true,
      articles_processed: allArticles.length,
      upserts_ok: inserted,
      upserts_failed: failed,
      used_news_fallback: usedFallback,
      topics_used: topUserTopics,
    });
  } catch (err) {
    console.error('Refresh handler crashed:', err);
    res.status(500).json({ error: err.message });
  }
}