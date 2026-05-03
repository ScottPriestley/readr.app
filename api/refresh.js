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
    // If AI returns malformed JSON, fall back to ['news'] for all
    console.error('Topic inference failed to parse:', text);
    return {};
  }
}

export default async function handler(req, res) {
  try {
    const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=50&apiKey=${process.env.NEWSAPI_KEY}`;
    const result = await fetchJSON(url);

    if (!result || result.status !== 'ok') {
      return res.status(500).json({ error: 'Failed to fetch news', detail: result });
    }

    // Infer topics for all articles in one AI call
    const topicMap = await inferTopics(result.articles);

    let count = 0;
    for (const item of result.articles) {
      if (!item.url || !item.title) continue;

      // Use inferred topics, fall back to ['news'] if title wasn't mapped
      const topics = topicMap[item.title] || ['news'];

      const { error } = await supabase.from('articles').upsert({
        url: item.url,
        title: item.title,
        summary: item.description || null,
        image_url: item.urlToImage || null,
        source: item.source?.name || 'Unknown',
        topics: topics,
        publish_date: item.publishedAt || null,
      }, { onConflict: 'url', ignoreDuplicates: true });
      if (!error) count++;
    }

    res.status(200).json({ success: true, articles: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}