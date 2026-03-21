const { GATEWAY_URL, GATEWAY_TOKEN } = require('./constants');

/**
 * Call LLM gateway
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string} model - defaults to claude-sonnet-4-5
 * @returns {Promise<string>}
 */
async function llmCall(systemPrompt, userPrompt, model = 'anthropic/claude-sonnet-4-5') {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ 
      model, 
      max_tokens: 4096, 
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]
    }),
  });
  
  if (!res.ok) {
    throw new Error(`LLM gateway returned ${res.status}: ${await res.text()}`);
  }
  
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Parse mark operations from LLM response
 * Handles both {"ops": [...]} and bare array formats
 */
function parseMarksFromLLM(text) {
  // Try {"ops": [...]} format first
  let match = text.match(/\{[\s\S]*"ops"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.ops) return obj.ops.filter(m => m && (
        (m.op === 'remove' && m.markId) ||  // remove ops just need markId
        (m.op === 'move' && m.markId) ||     // move ops need markId (coords optional)
        (typeof m.x === 'number' && typeof m.y === 'number')  // add ops need coords
      ));
    } catch {}
  }
  
  // Fall back to bare array
  match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  
  try { 
    return JSON.parse(match[0]).filter(m => m && (
      (m.op === 'remove' && m.markId) ||
      (m.op === 'move' && m.markId) ||
      (typeof m.x === 'number' && typeof m.y === 'number')
    )); 
  } catch { 
    return []; 
  }
}

module.exports = { llmCall, parseMarksFromLLM };
