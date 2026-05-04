import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return res.json();
}

async function inferTopics(articles) {
  const titles = articles.map(a => a.title).filter(Boolean);

  const prompt = `You are a news topic classifier. For each article title below, return 2-3 short topic tags that best describe the article. Tags should be specific but reusable (e.g. "artificial intelligence", "NBA", "climate change", "stock market", "electric vehicles").

Return ONLY a valid JSON object where each key is the exact article title and the value is an array of tag strings. No explanation, no markdown, just the JSON object.

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

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
    }),
  });

  const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(text);
  } catch {
    console.error('Topic inference failed to parse:', text);
    return {};
  }
}

async function fetchFromNewsAPI() {
  const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=50&apiKey=${process.env.NEWSAPI_KEY}`;
  const result = await fetchJSON(url);
  if (!result || result.status !== 'ok') return [];

  return result.articles
    .filter(a => a.url && a.title)
    .map(a => ({
      url: a.url,
      title: a.title,
      summary: a.description || null,
      image_url: a.urlToImage || null,
      source: a.source?.name || 'Unknown',
      publish_date: a.publishedAt || null,
    }));
}

async function fetchFromTheNewsAPI() {
  const url = `https://api.thenewsapi.com/v1/news/top?api_token=${process.env.THENEWSAPI_KEY}&language=en&limit=50`;
  const result = await fetchJSON(url);
  if (!result || !result.data) return [];

  return result.data
    .filter(a => a.url && a.title)
    .map(a => ({
      url: a.url,
      title: a.title,
      summary: a.description || null,
      image_url: a.image_url || null,
      source: a.source || 'Unknown',
      publish_date: a.published_at || null,
    }));
}

export default async function handler(req, res) {
  try {
    // Fetch from both sources in parallel
    const [newsAPIArticles, theNewsAPIArticles] = await Promise.all([
      fetchFromNewsAPI(),
      fetchFromTheNewsAPI(),
    ]);

    // Merge and deduplicate by URL
    const seen = new Set();
    const allArticles = [...newsAPIArticles, ...theNewsAPIArticles].filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    if (allArticles.length === 0) {
      return res.status(500).json({ error: 'No articles fetched from any source' });
    }

    // Infer topics for all articles in one AI call
    const topicMap = await inferTopics(allArticles);

    let count = 0;
    for (const item of allArticles) {
      const topics = topicMap[item.title] || ['news'];
      const { error } = await supabase.from('articles').upsert({
        ...item,
        topics,
      }, { onConflict: 'url', ignoreDuplicates: true });
      if (!error) count++;
    }

    res.status(200).json({ 
      success: true, 
      articles: count,
      sources: {
        newsapi: newsAPIArticles.length,
        thenewsapi: theNewsAPIArticles.length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}