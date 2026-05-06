import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Tunables
const TOP_TOPIC_COUNT = 15;
const PER_TOPIC_LIMIT = 20;
const INFERENCE_BATCH_SIZE = 25;
const MIN_PREFERENCE_SCORE = 0.1;

// The same curated topics shown during onboarding — the canonical vocabulary.
const CURATED_TOPICS = [
  'technology', 'artificial intelligence', 'science', 'space', 'health',
  'politics', 'world news', 'business', 'finance', 'stock market',
  'sports', 'nfl', 'nba', 'soccer', 'formula 1',
  'climate', 'environment', 'entertainment', 'film', 'music',
  'gaming', 'food', 'travel', 'history', 'law & crime',
];

// Google News static category feed IDs — these never change
const CATEGORY_FEEDS = [
  { label: 'Technology',     url: 'https://news.google.com/rss/topics/CAAqJggKIiBDBkFTQkFDSWhJbktrb0lMVkJRU0JBY2dNQ1FBQQ?hl=en-US&gl=US&ceid=US:en' },
  { label: 'Business',       url: 'https://news.google.com/rss/topics/CAAqJggKIiBDBkFTQkFDSWhJbktrb0lMVkJRU0JBY2dNQ1FBQQ?hl=en-US&gl=US&ceid=US:en' },
  { label: 'Science',        url: 'https://news.google.com/rss/topics/CAAqJggKIiBDBkFTQkFDU2hJbktrb0lMVkJRU0JBY2dNQ1FBQQ?hl=en-US&gl=US&ceid=US:en' },
  { label: 'Health',         url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ?hl=en-US&gl=US&ceid=US:en' },
  { label: 'Sports',         url: 'https://news.google.com/rss/topics/CAAqJggKIiBDBkFTQkFDU2hJbktrb0lMVkJRU0pBY2dNQ1FBQQ?hl=en-US&gl=US&ceid=US:en' },
  { label: 'Entertainment',  url: 'https://news.google.com/rss/topics/CAAqJggKIiBDBkFTQkFDU2hJbktrb0lMVkJRU0pBY2dNQ1FBQQ?hl=en-US&gl=US&ceid=US:en' },
];

// ─── RSS Fetching ──────────────────────────────────────────────────────────────

async function fetchRSSFeed(url, label) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Readr/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) {
      console.error(`[RSS:${label}] HTTP ${res.status}: ${res.statusText}`);
      return [];
    }
    const xml = await res.text();
    return parseRSSItems(xml, label);
  } catch (err) {
    console.error(`[RSS:${label}] fetch failed:`, err.message);
    return [];
  }
}

function parseRSSItems(xml, label) {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item;
    if (!items) {
      console.warn(`[RSS:${label}] No items found in feed`);
      return [];
    }
    const itemArray = Array.isArray(items) ? items : [items];
    const articles = itemArray
      .map(item => normalizeRSSItem(item))
      .filter(a => a.url && a.title);
    console.log(`[RSS:${label}] ${articles.length} articles parsed`);
    return articles;
  } catch (err) {
    console.error(`[RSS:${label}] parse failed:`, err.message);
    return [];
  }
}

function normalizeRSSItem(item) {
  // Google News RSS uses <source url="..."> for the publisher name
  const sourceName = typeof item.source === 'object'
    ? (item.source['#text'] || item.source['_'] || 'Unknown')
    : (item.source || 'Unknown');

  // Strip Google News redirect URLs — extract the real article URL from the guid
  // Google News guids look like: https://news.google.com/rss/articles/...
  // The actual article link is in <link>
  const url = item.link || item.guid?.['#text'] || item.guid || null;

  // Remove HTML tags from description if present
  const summary = item.description
    ? String(item.description).replace(/<[^>]+>/g, '').trim() || null
    : null;

  return {
    url: typeof url === 'string' ? url.trim() : null,
    title: item.title ? String(item.title).trim() : null,
    summary,
    image_url: item.enclosure?.['@_url'] || item['media:content']?.['@_url'] || null,
    source: sourceName,
    source_url: extractDomain(typeof url === 'string' ? url : ''),
    publish_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
  };
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── Google News RSS Sources ───────────────────────────────────────────────────

/**
 * Fetch a Google News search feed for a specific topic query.
 * Returns up to PER_TOPIC_LIMIT articles.
 */
async function fetchTopicFeed(topic) {
  const q = encodeURIComponent(topic);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const articles = await fetchRSSFeed(url, `topic:${topic}`);
  return articles.slice(0, PER_TOPIC_LIMIT);
}

/**
 * Fetch all six Google News category feeds for broad baseline coverage.
 */
async function fetchCategoryFeeds() {
  const results = await Promise.all(
    CATEGORY_FEEDS.map(({ label, url }) => fetchRSSFeed(url, `category:${label}`))
  );
  return results.flat();
}

// ─── User Preference Helpers (unchanged) ──────────────────────────────────────

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

// ─── Topic Inference (unchanged) ──────────────────────────────────────────────

async function inferTopicsBatch(titles, batchLabel, canonicalTopics) {
  const vocabularyList = canonicalTopics.join(', ');

  const prompt = `You are a news topic classifier. For each article title, assign 2-3 topic tags.

IMPORTANT: You must use the canonical topic vocabulary below wherever it fits. Only invent a new tag if none of the canonical topics apply.

Canonical topics (use these exact strings):
${vocabularyList}

For each title, return the best matching canonical topics first. If a canonical topic clearly applies, you MUST use the exact canonical string (e.g. use "artificial intelligence" not "AI", use "formula 1" not "F1", use "stock market" not "stocks").

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
        temperature: 0,
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

async function inferTopics(articles) {
  if (articles.length === 0) return {};

  const userTopics = await getUserPreferenceTopics();
  const canonicalTopics = [...new Set([...CURATED_TOPICS, ...userTopics])];

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
  for (const result of results) Object.assign(merged, result);

  console.log(`[inferTopics] Total: ${Object.keys(merged).length}/${titles.length} titles classified across ${batches.length} batches`);
  return merged;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const topUserTopics = await getTopUserTopics();
    console.log(`Top user topics (${topUserTopics.length}):`, topUserTopics);

    // Fetch topic-specific feeds + broad category feeds in parallel
    const [topicResults, categoryArticles] = await Promise.all([
      Promise.all(topUserTopics.map(topic => fetchTopicFeed(topic))),
      fetchCategoryFeeds(),
    ]);

    // Deduplicate across all sources
    const seen = new Set();
    const allArticles = [];
    for (const article of [...topicResults.flat(), ...categoryArticles]) {
      if (!article.url || seen.has(article.url)) continue;
      seen.add(article.url);
      allArticles.push(article);
    }

    if (allArticles.length === 0) {
      console.error('No articles fetched — Google News RSS may be unreachable');
      return res.status(500).json({ error: 'No articles fetched from any source' });
    }

    console.log(`Fetched ${allArticles.length} unique articles (${topUserTopics.length} topic feeds + ${CATEGORY_FEEDS.length} category feeds)`);

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