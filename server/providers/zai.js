export async function runZai({ apiKey, model, prompt, systemPrompt, temperature, maxTokens }) {
  const payload = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: prompt },
    ],
    temperature,
    stream: false,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  // Use coding endpoint for GLM Coding Plan
  const response = await fetch("https://api.z.ai/api/coding/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Z.AI error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content || ""
  const usage = data?.usage || null
  return { text, raw: data, usage }
}
