const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer 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',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'Say hello' }],
    max_tokens: 100
  })
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));