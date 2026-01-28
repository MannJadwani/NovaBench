export async function runAnthropic({ apiKey, model, prompt, systemPrompt, temperature, maxTokens }) {
  const payload = {
    model,
    temperature,
    messages: [{ role: "user", content: prompt }],
  }
  if (systemPrompt) payload.system = systemPrompt
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const text = Array.isArray(data?.content)
    ? data.content.map((item) => item.text || "").join("")
    : ""
  const usage = data?.usage || null
  return { text, raw: data, usage }
}
