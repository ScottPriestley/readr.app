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

    const articleList = articles.map((a, i) => `${i+1}. ID:${a.id} | "${a.title}" | ${a.source} | topics:${a.topics?.join(',')}`).join('\n');

    const prompt = `You are a news feed personalization algorithm. Rank these articles for a user based on their preferences.

User preferences:
- Favourite topics: ${topicPrefs}
- Favourite sources: ${sourcePrefs}  
- Avoid sources: ${avoidSources}

Articles to rank:
${articleList}

Instructions: Return ONLY a valid JSON array containing the article IDs in order from most to least relevant. Example format: ["uuid1","uuid2","uuid3"]
Do not include any other text, explanation, or markdown.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.1
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