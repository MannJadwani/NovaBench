import express from "express"
import cors from "cors"
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createRun, deleteRun, getRunHtml, listRuns, saveScore } from "./storage/fs.js"
import { runOpenAI } from "./providers/openai.js"
import { runAnthropic } from "./providers/anthropic.js"
import { runZai } from "./providers/zai.js"
import { runMinimax, streamMinimax } from "./providers/minimax.js"
import { runOpenRouter, streamOpenRouter } from "./providers/openrouter.js"

const app = express()
const port = 3001

app.use(cors())
app.use(express.json({ limit: "2mb" }))

const providers = {
  openai: runOpenAI,
  anthropic: runAnthropic,
  zai: runZai,
  minimax: runMinimax,
  openrouter: runOpenRouter,
}

function extractHtml(text) {
  if (!text) return ""
  const fencedHtml = text.match(/```html\s*([\s\S]*?)```/i)
  if (fencedHtml?.[1]) return fencedHtml[1].trim()

  const fencedAny = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/)
  if (fencedAny?.[1]) return fencedAny[1].trim()

  const htmlMatch = text.match(/<html[\s\S]*<\/html>/i)
  if (htmlMatch?.[0]) return htmlMatch[0]

  const start = text.indexOf("<")
  const end = text.lastIndexOf(">")
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim()
  }

  return text.trim()
}

function getApiKey(provider, apiKey, apiKeys) {
  if (apiKey) return apiKey
  if (apiKeys?.[provider]) return apiKeys[provider]
  const envMap = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    zai: process.env.ZAI_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  }
  return envMap[provider]
}

function getAiSdkModel(provider, apiKey, model) {
  if (provider === "openai") {
    const client = createOpenAI({ apiKey })
    return client(model)
  }
  if (provider === "anthropic") {
    const client = createAnthropic({ apiKey })
    return client(model)
  }
  if (provider === "openrouter") {
    const client = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    return client.chatModel(model)
  }
  // Minimax and Z.AI use native streaming, not AI SDK
  return null
}

async function streamOpenAICompatible({ url, headers, payload, onDelta }) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, stream: true }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[streamOpenAICompatible] Error ${response.status}:`, errorText)
    throw new Error(errorText || `Stream request failed with status ${response.status}`)
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
          const delta = parsed?.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            onDelta(delta)
          }
          // Capture usage from final chunk if present (OpenAI-compatible APIs)
          if (parsed?.usage) {
            usage = parsed.usage
          }
        }
      }
    }
  } finally {
    // Ensure reader is released
    reader.releaseLock()
  }

  return { text: fullText, usage }
}

async function listModels({ provider, apiKey }) {
  const key = getApiKey(provider, apiKey, null)
  if (!key) throw new Error("Missing API key for provider")

  if (provider === "openrouter") {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) throw new Error("Failed to load OpenRouter models")
    const data = await response.json()
    return data?.data?.map((model) => model.id) || []
  }

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) throw new Error("Failed to load OpenAI models")
    const data = await response.json()
    return data?.data?.map((model) => model.id) || []
  }

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    })
    if (!response.ok) throw new Error("Failed to load Anthropic models")
    const data = await response.json()
    return data?.data?.map((model) => model.id) || []
  }

  if (provider === "zai") {
    // Use coding endpoint for GLM Coding Plan
    const response = await fetch("https://api.z.ai/api/coding/paas/v4/models", {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) return []
    const data = await response.json()
    const raw = data?.data || data?.models || []
    if (Array.isArray(raw)) {
      return raw
        .map((model) =>
          typeof model === "string" ? model : model.id || model.name || model.model_id
        )
        .filter(Boolean)
    }
    return []
  }

  if (provider === "minimax") {
    const response = await fetch("https://api.minimax.io/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) return []
    const data = await response.json()
    const raw = data?.data?.models || data?.data || data?.models || []
    if (Array.isArray(raw)) {
      return raw
        .map((model) =>
          typeof model === "string" ? model : model.id || model.model || model.name
        )
        .filter(Boolean)
    }
    return []
  }

  return []
}

app.get("/api/runs", async (req, res) => {
  const data = await listRuns()
  res.json({ runs: data })
})

app.post("/api/models", async (req, res) => {
  const { provider, apiKey } = req.body
  if (!provider) {
    res.status(400).json({ error: "Provider is required" })
    return
  }
  try {
    const models = await listModels({ provider, apiKey })
    res.json({ models })
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to load models" })
  }
})

app.get("/api/runs/:runId/html", async (req, res) => {
  const html = await getRunHtml(req.params.runId)
  if (!html) {
    res.status(404).json({ error: "Run not found" })
    return
  }
  if (req.query.raw === "1") {
    res.type("text/plain").send(html)
    return
  }
  res.type("html").send(html)
})

app.post("/api/runs/:runId/score", async (req, res) => {
  const score = req.body
  const summary = await saveScore(req.params.runId, score)
  if (!summary) {
    res.status(404).json({ error: "Run not found" })
    return
  }
  res.json({ summary })
})

app.delete("/api/runs/:runId", async (req, res) => {
  const entry = await deleteRun(req.params.runId)
  if (!entry) {
    res.status(404).json({ error: "Run not found" })
    return
  }
  res.json({ entry })
})

app.post("/api/run", async (req, res) => {
  const { provider, model, prompt, systemPrompt, params, benchmark, apiKey, apiKeys } = req.body

  if (!providers[provider]) {
    res.status(400).json({ error: "Unsupported provider" })
    return
  }
  if (!model || !prompt) {
    res.status(400).json({ error: "Model and prompt are required" })
    return
  }

  const key = getApiKey(provider, apiKey, apiKeys)
  if (!key) {
    res.status(400).json({ error: "Missing API key for provider" })
    return
  }

  const temperature = params?.temperature ?? 0.7
  const maxTokens = params?.maxTokens ?? null

  try {
    const start = performance.now()
    const result = await providers[provider]({
      apiKey: key,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxTokens,
    })
    const latencyMs = Math.round(performance.now() - start)
    const html = extractHtml(result.text)

    const entry = await createRun({
      provider,
      model,
      prompt,
      response: result.raw,
      html,
      params: { temperature, maxTokens },
      benchmark,
      latencyMs,
      tokenUsage: result.usage,
    })

    res.json({ entry, html })
  } catch (error) {
    const message = error?.message || String(error) || "Run failed"
    console.error("Run failed", {
      provider,
      model,
      message,
    })
    res.status(500).json({ error: message })
  }
})

app.post("/api/run/stream", async (req, res) => {
  const { provider, model, prompt, systemPrompt, params, benchmark, apiKey, apiKeys } = req.body
  
  console.log(`[stream] Starting request: provider=${provider}, model=${model}, benchmark=${benchmark?.title || 'unknown'}`)
  
  if (!providers[provider]) {
    res.status(400).json({ error: "Unsupported provider" })
    return
  }
  if (!model || !prompt) {
    res.status(400).json({ error: "Model and prompt are required" })
    return
  }

  const key = getApiKey(provider, apiKey, apiKeys)
  if (!key) {
    res.status(400).json({ error: "Missing API key for provider" })
    return
  }

  const temperature = params?.temperature ?? 0.7
  const maxTokens = params?.maxTokens ?? null

  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")

  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  try {
    const start = performance.now()
    let text = ""
    let usage = null
    let raw = null

    if (provider === "zai") {
      // Z.AI - use coding endpoint for GLM Coding Plan
      const url = "https://api.z.ai/api/coding/paas/v4/chat/completions"
      const payload = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt },
        ],
        temperature,
      }
      if (maxTokens) payload.max_tokens = maxTokens

      console.log(`[stream] Z.AI request to ${url}`)
      const result = await streamOpenAICompatible({
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        payload,
        onDelta: (delta) => sendEvent({ type: "delta", text: delta }),
      })
      text = result.text
      usage = result.usage
      raw = { text }
    } else if (provider === "minimax") {
      // Minimax - use native streaming (bypasses AI SDK v5 compatibility issues)
      console.log(`[stream] Minimax request`)
      const result = await streamMinimax({
        apiKey: key,
        model,
        prompt,
        systemPrompt,
        temperature,
        maxTokens,
        onDelta: (delta) => sendEvent({ type: "delta", text: delta }),
      })
      text = result.text
      raw = result.raw
      usage = result.usage
    } else if (provider === "openrouter") {
      // OpenRouter - use native streaming to capture token usage from final chunk
      console.log(`[stream] OpenRouter native streaming request`)
      const result = await streamOpenRouter({
        apiKey: key,
        model,
        prompt,
        systemPrompt,
        temperature,
        maxTokens,
        onDelta: (delta) => sendEvent({ type: "delta", text: delta }),
      })
      text = result.text
      raw = result.raw
      usage = result.usage
    } else {
      // OpenAI, Anthropic - use AI SDK streaming
      console.log(`[stream] AI SDK request for ${provider}`)
      const sdkModel = getAiSdkModel(provider, key, model)
      if (sdkModel) {
        const result = streamText({
          model: sdkModel,
          system: systemPrompt,
          prompt,
          temperature,
          ...(maxTokens ? { maxTokens } : {}),
        })

        for await (const delta of result.textStream) {
          text += delta
          sendEvent({ type: "delta", text: delta })
        }

        usage = result.usage || null
        raw = { text }
      } else {
        // Fallback to non-streaming provider
        console.log(`[stream] Fallback to non-streaming for ${provider}`)
        const result = await providers[provider]({
          apiKey: key,
          model,
          prompt,
          systemPrompt,
          temperature,
          maxTokens,
        })
        text = result.text
        raw = result.raw
        usage = result.usage
      }
    }

    const latencyMs = Math.round(performance.now() - start)
    console.log(`[stream] Completed in ${latencyMs}ms, text length: ${text.length}`)
    
    const html = extractHtml(text)
    const entry = await createRun({
      provider,
      model,
      prompt,
      response: raw || { text },
      html,
      params: { temperature, maxTokens },
      benchmark,
      latencyMs,
      tokenUsage: usage,
    })

    sendEvent({ type: "done", entry, html })
    res.end()
  } catch (error) {
    const message = error?.message || String(error) || "Run failed"
    console.error("[stream] Run failed", { provider, model, message, stack: error?.stack })
    sendEvent({ type: "error", message })
    res.end()
  }
})

app.listen(port, () => {
  console.log(`UI Bench server running on http://localhost:${port}`)
})
