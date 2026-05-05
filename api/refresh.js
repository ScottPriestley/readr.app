import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Tunables
const TOP_TOPIC_COUNT = 15;          // How many top user topics to fetch per refresh
const PER_TOPIC_PAGE_SIZE = 20;      // Articles per topic from each source
const FALLBACK_PAGE_SIZE = 30;       // Generic baseline articles
const MIN_PREFERENCE_SCORE = 0.1;    // Only count topics users actually like

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

async function inferTopics(articles) {
  if (articles.length === 0) return {};

  const titles = articles.map(a => a.title).filter(Boolean);
  console.log(`[inferTopics] Starting inference for ${titles.length} titles`);

  const prompt = `You are a news topic classifier. For each article title below, return 2-3 short topic tags that best describe the article. Tags should be specific but reusable (e.g. "artificial intelligence", "NBA", "climate change", "stock market", "electric vehicles").

Return ONLY a valid JSON object where each key is the exact article title and the value is an array of tag strings. No explanation, no markdown, just the JSON object.

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
        temperature: 0.2,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      }),
    });

    console.log(`[inferTopics] OpenRouter HTTP ${response.status}`);

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[inferTopics] OpenRouter error body: ${errBody.slice(0, 500)}`);
      return {};
    }

    const data = await response.json();
    console.log(`[inferTopics] Response keys: ${Object.keys(data).join(', ')}`);

    if (data.error) {
      console.error(`[inferTopics] OpenRouter returned error:`, JSON.stringify(data.error));
      return {};
    }

    const text = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(`[inferTopics] finish_reason: ${finishReason}, content length: ${text?.length || 0}`);

    if (!text) {
      console.error('[inferTopics] No content in response. Full data:', JSON.stringify(data).slice(0, 1000));
      return {};
    }

    try {
      const parsed = JSON.parse(text);
      const mappingCount = Object.keys(parsed).length;
      console.log(`[inferTopics] Parsed successfully: ${mappingCount} mappings for ${titles.length} titles`);

      const sampleKeys = Object.keys(parsed).slice(0, 3);
      console.log(`[inferTopics] Sample keys returned:`, sampleKeys);
      console.log(`[inferTopics] Sample input titles:`, titles.slice(0, 3));

      return parsed;
    } catch (err) {
      console.error('[inferTopics] JSON parse failed:', err.message);
      console.error('[inferTopics] Raw text (first 500 chars):', text.slice(0, 500));
      console.error('[inferTopics] Raw text (last 200 chars):', text.slice(-200));
      return {};
    }
  } catch (err) {
    console.error('[inferTopics] Request threw:', err.message, err.stack);
    return {};
  }
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