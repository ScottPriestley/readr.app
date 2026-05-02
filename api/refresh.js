import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return res.json();
}

export default async function handler(req, res) {
  try {
    const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=50&apiKey=${process.env.NEWSAPI_KEY}`;
    const result = await fetchJSON(url);

    if (!result || result.status !== 'ok') {
      return res.status(500).json({ error: 'Failed to fetch news', detail: result });
    }

    let count = 0;
    for (const item of result.articles) {
      if (!item.url || !item.title) continue;
      const { error } = await supabase.from('articles').upsert({
        url: item.url,
        title: item.title,
        summary: item.description || null,
        image_url: item.urlToImage || null,
        source: item.source?.name || 'Unknown',
        topics: ['news'],
        publish_date: item.publishedAt || null,
      }, { onConflict: 'url', ignoreDuplicates: true });
      if (!error) count++;
    }

    res.status(200).json({ success: true, articles: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}