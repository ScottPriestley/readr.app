export default async function handler(req, res) {
  const { topics } = req.body;
  if (!topics || !Array.isArray(topics)) {
    return res.status(400).json({ error: 'topics array required' });
  }

  const prompt = `Normalise each of these user-entered topic interests into 1-3 clean, reusable topic tag strings (e.g. "artificial intelligence", "NBA", "climate change").

Return ONLY a valid JSON array of normalised tag strings, no duplicates, no explanation, no markdown.

Input: ${topics.join(', ')}`;

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
  const text = data.choices?.[0]?.message?.content || '[]';
  try {
    return res.status(200).json({ normalised: JSON.parse(text) });
  } catch {
    return res.status(200).json({ normalised: topics });
  }
}