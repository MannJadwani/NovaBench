export async function runOpenRouter({ apiKey, model, prompt, systemPrompt, temperature, maxTokens }) {
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    temperature,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content || ""
  const usage = data?.usage || null
  return { text, raw: data, usage }
}

/**
 * Stream OpenRouter API with native fetch to capture token usage from final chunk
 * OpenRouter sends usage stats in the final SSE chunk per their docs
 */
export async function streamOpenRouter({ apiKey, model, prompt, systemPrompt, temperature, maxTokens, onDelta }) {
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    temperature,
    stream: true,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter stream error ${response.status}: ${errorText}`)
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
      const parts = buffer.split("\n\n")
      buffer = parts.pop() || ""
      
      for (const part of parts) {
        const lines = part.split("\n")
        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const data = line.replace("data:", "").trim()
          if (!data || data === "[DONE]") continue
          
          let parsed
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          
          // Extract content delta
          const delta = parsed?.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            onDelta(delta)
          }
          
          // OpenRouter sends usage in the final chunk
          if (parsed?.usage) {
            usage = parsed.usage
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { text: fullText, raw: { text: fullText }, usage }
}
