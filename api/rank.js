import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const { user_id } = req.query;

    const [{ data: prefs }, { data: articles }] = await Promise.all([
      supabase.from('user_preferences').select('*').eq('user_id', user_id),
      supabase.from('articles').select('id, title, source, topics').order('created_at', { ascending: false }).limit(50)
    ]);

    if (!articles || articles.length === 0) return res.status(200).json({ ranked: [] });

    const topicPrefs = prefs?.filter(p => p.topic && p.preference_score > 0).map(p => `${p.topic}(${p.preference_score.toFixed(1)})`).join(', ') || 'none';
    const sourcePrefs = prefs?.filter(p => p.source && p.preference_score > 0).map(p => `${p.source}(${p.preference_score.toFixed(1)})`).join(', ') || 'none';
    const avoidSources = prefs?.filter(p => p.source && p.preference_score <= -0.5).map(p => p.source).join(', ') || 'none';

    const articleList = articles.slice(0, 20).map((a, i) => `${i+1}|${a.id}|${a.title}|${a.source}`).join('\n');

    const prompt = `Rank these news articles for someone who likes these topics: ${topicPrefs} and these sources: ${sourcePrefs}.

Articles (format: number|id|title|source):
${articleList}

Reply with ONLY a JSON array of the IDs in ranked order. Example: ["id1","id2","id3"]`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a news ranking algorithm. Always respond with only a valid JSON array of IDs.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0
      })
    });

    const aiResult = await response.json();
    const rawText = aiResult.choices?.[0]?.message?.content || '[]';
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    
    let ranked = [];
    try {
      ranked = JSON.parse(cleanText);
    } catch(e) {
      console.error('Failed to parse AI response:', rawText);
    }

    res.status(200).json({ ranked, debug: { topicPrefs, sourcePrefs, rawText: rawText.slice(0, 200) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}