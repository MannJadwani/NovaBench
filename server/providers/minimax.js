// Minimax API v2 - direct REST API (bypasses AI SDK compatibility issues)
// Docs: https://platform.minimaxi.com/document/ChatCompletion%20v2

export async function runMinimax({ apiKey, model, prompt, systemPrompt, temperature, maxTokens }) {
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", name: "system", content: systemPrompt }] : []),
      { role: "user", name: "user", content: prompt },
    ],
    temperature,
    stream: false,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Minimax error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content || ""
  const usage = data?.usage || null
  return { text, raw: data, usage }
}

// Streaming version for SSE
export async function streamMinimax({ apiKey, model, prompt, systemPrompt, temperature, maxTokens, onDelta }) {
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", name: "system", content: systemPrompt }] : []),
      { role: "user", name: "user", content: prompt },
    ],
    temperature,
    stream: true,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[streamMinimax] Error ${response.status}:`, errorText)
    throw new Error(`Minimax error ${response.status}: ${errorText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let fullText = ""
  let usage = null

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      
      // Split on newlines - Minimax uses single newline separators
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (!data || data === "[DONE]") continue
        
        let parsed
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        
        // Extract delta content
        const delta = parsed?.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          onDelta(delta)
        }
        
        // Capture usage from final chunk if present
        if (parsed?.usage) {
          usage = parsed.usage
        }
      }
    }
  } finally {
    // Ensure reader is released
    reader.releaseLock()
  }

  return { text: fullText, raw: { text: fullText }, usage }
}
