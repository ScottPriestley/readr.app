import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const { user_id } = req.query;

    const [{ data: prefs }, { data: articles }] = await Promise.all([
      supabase.from('user_preferences').select('*').eq('user_id', user_id),
      supabase.from('articles').select('id, title, source, topics').order('created_at', { ascending: false }).limit(20)
    ]);

    if (!articles || articles.length === 0) return res.status(200).json({ ranked: [] });

    const topicPrefs = prefs?.filter(p => p.topic && p.preference_score > 0).map(p => `${p.topic}(${p.preference_score.toFixed(1)})`).join(', ') || 'none';
    const sourcePrefs = prefs?.filter(p => p.source && p.preference_score > 0).map(p => `${p.source}(${p.preference_score.toFixed(1)})`).join(', ') || 'none';

    const articleList = articles.map((a, i) => `${i+1}. ${a.id} | "${a.title}" | ${a.source}`).join('\n');

    const prompt = `You must rank the following ${articles.length} articles.

User preferences:
Liked topics: ${topicPrefs}
Liked sources: ${sourcePrefs}

Articles:
${articleList}

Rules:
- Return every article ID exactly once.
- Do not remove any articles.
- Do not return an empty array.
- Do not invent IDs.
- Return only a valid JSON array of article IDs.
- The array must contain exactly ${articles.length} IDs.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a news ranking algorithm. Always respond with only a valid JSON array of IDs, nothing else.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0
      })
    });

    const aiResult = await response.json();
    if (!response.ok || !aiResult.choices?.[0]?.message?.content) {
  return res.status(200).json({
    ranked: [],
    debug: {
      openRouterStatus: response.status,
      openRouterOk: response.ok,
      openRouterResponse: aiResult,
      topicPrefs,
      sourcePrefs,
      articleCount: articles.length
    }
  });
}

const rawText = aiResult.choices[0].message.content;
    const cleanText = rawText.replace(/```json|```/g, '').trim();

    let ranked = [];
try {
  const parsed = JSON.parse(cleanText);

  const validIds = new Set(articles.map(a => String(a.id)));
  const seen = new Set();

  if (Array.isArray(parsed)) {
    ranked = parsed
      .map(id => String(id))
      .filter(id => {
        if (!validIds.has(id)) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  const missingIds = articles
    .map(a => String(a.id))
    .filter(id => !seen.has(id));

  ranked = [...ranked, ...missingIds];
} catch(e) {
  console.error('Failed to parse AI response:', rawText);
  ranked = articles.map(a => String(a.id));
}

    res.status(200).json({ ranked, debug: { topicPrefs, sourcePrefs, rawText, articleCount: articles.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}