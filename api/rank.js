import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const { user_id } = req.query;
    const [{ data: interactions }, { data: prefs }, { data: articles }] = await Promise.all([
      supabase.from('user_interactions').select('*, articles(title)').eq('user_id', user_id).order('timestamp', { ascending: false }).limit(20),
      supabase.from('user_preferences').select('*').eq('user_id', user_id),
      supabase.from('articles').select('id, title, source, topics').order('created_at', { ascending: false }).limit(50)
    ]);

    if (!articles || articles.length === 0) return res.status(200).json({ ranked: [] });

    const liked = interactions?.filter(i => i.interaction_type === 'like').map(i => i.articles?.title).filter(Boolean).join('; ') || 'none';
    const disliked = interactions?.filter(i => i.interaction_type === 'dislike').map(i => i.articles?.title).filter(Boolean).join('; ') || 'none';
    const topicPrefs = prefs?.filter(p => p.topic && p.preference_score > 0).map(p => p.topic).join(', ') || 'none';
    const sourcePrefs = prefs?.filter(p => p.source && p.preference_score > 0).map(p => p.source).join(', ') || 'none';

    const prompt = `Rank these articles for a user. Liked: ${liked}. Disliked: ${disliked}. Fav topics: ${topicPrefs}. Fav sources: ${sourcePrefs}. Articles: ${articles.map(a => JSON.stringify({id: a.id, title: a.title, source: a.source})).join(', ')}. Return ONLY a JSON array of IDs: ["id1","id2"]`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-flash-1.5', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 })
    });

    const aiResult = await response.json();
    const rawText = aiResult.choices?.[0]?.message?.content || '[]';
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    const ranked = JSON.parse(cleanText);
    res.status(200).json({ ranked, debug: { liked, topicPrefs, rawText } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}