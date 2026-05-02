import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    const { user_id } = req.query;

    // Get user's recent interactions
    const { data: interactions } = await supabase
      .from('user_interactions')
      .select('*, articles(*)')
      .eq('user_id', user_id)
      .order('timestamp', { ascending: false })
      .limit(50);

    // Get user preferences
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user_id);

    // Get candidate articles to rank
    const { data: articles } = await supabase
      .from('articles')
      .select('id, title, source, topics, summary')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!articles || articles.length === 0) {
      return res.status(200).json({ ranked: [] });
    }

    // Build context for AI
    const likedArticles = interactions
      ?.filter(i => i.interaction_type === 'like')
      .map(i => i.articles?.title)
      .filter(Boolean)
      .slice(0, 10);

    const dislikedArticles = interactions
      ?.filter(i => i.interaction_type === 'dislike')
      .map(i => i.articles?.title)
      .filter(Boolean)
      .slice(0, 10);

    const topicPrefs = prefs
      ?.filter(p => p.topic && p.preference_score > 0)
      .map(p => `${p.topic} (score: ${p.preference_score.toFixed(1)})`)
      .join(', ');

    const sourcePrefs = prefs
      ?.filter(p => p.source && p.preference_score > 0)
      .map(p => `${p.source} (score: ${p.preference_score.toFixed(1)})`)
      .join(', ');

    const prompt = `You are a personalized news feed algorithm. Based on the user's engagement history, rank these articles from most to least relevant for this user.

User's liked articles: ${likedArticles?.join('; ') || 'none yet'}
User's disliked articles: ${dislikedArticles?.join('; ') || 'none yet'}
Preferred topics: ${topicPrefs || 'none yet'}
Preferred sources: ${sourcePrefs || 'none yet'}

Articles to rank (return ONLY a JSON array of article IDs in order from most to least relevant, no other text):
${articles.map(a => `{"id":"${a.id}","title":"${a.title}","source":"${a.source}","topics":${JSON.stringify(a.topics)}}`).join('\n')}

Return ONLY a JSON array like: ["id1","id2","id3"]`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      }),
    });

    const aiResult = await response.json();
    const rawText = aiResult.choices?.[0]?.message?.content || '[]';
    
    // Parse the ranked IDs
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    const rankedIds = JSON.parse(cleanText);

    // Return articles in AI-ranked order
    const articleMap = Object.fromEntries(articles.map(a => [a.id, a]));
    const ranked = rankedIds
      .filter(id => articleMap[id])
      .map(id => id);

    res.status(200).json({ ranked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}