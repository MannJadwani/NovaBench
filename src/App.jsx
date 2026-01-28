import { useEffect, useMemo, useState } from "react"
import benchmarks from "./benchmarks.json"

const providers = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "zai", label: "Z.AI (GLM)" },
  { id: "minimax", label: "Minimax" },
  { id: "openrouter", label: "OpenRouter" },
]

const tempDefaults = {
  openai: 0.7,
  anthropic: 0.5,
  zai: 0.7,
  minimax: 0.7,
  openrouter: 0.7,
}

const scoreQuestions = [
  { id: "structure_valid_html", label: "Valid HTML structure", category: "Structure" },
  { id: "structure_semantic", label: "Uses semantic elements", category: "Structure" },
  { id: "structure_layout", label: "Layout matches the prompt", category: "Structure" },
  { id: "structure_no_breaks", label: "No broken or missing elements", category: "Structure" },
  { id: "style_tailwind", label: "Tailwind classes applied correctly", category: "Styling" },
  { id: "style_spacing", label: "Consistent spacing and alignment", category: "Styling" },
  { id: "style_contrast", label: "Readable contrast", category: "Styling" },
  { id: "style_responsive", label: "Responsive layout", category: "Styling" },
  { id: "complete_sections", label: "All sections from prompt present", category: "Completeness" },
  { id: "complete_components", label: "All required components included", category: "Completeness" },
  { id: "complete_content", label: "Content filled with reasonable copy", category: "Completeness" },
  { id: "complete_hierarchy", label: "Content hierarchy is clear", category: "Completeness" },
  { id: "function_buttons", label: "Buttons look actionable", category: "Functionality" },
  { id: "function_forms", label: "Form inputs look usable", category: "Functionality" },
  { id: "function_states", label: "Hover or active states present", category: "Functionality" },
  { id: "function_navigation", label: "Navigation or links feel usable", category: "Functionality" },
  { id: "polish_typography", label: "Typography is clean and readable", category: "Polish" },
  { id: "polish_balance", label: "Visual balance and rhythm", category: "Polish" },
  { id: "polish_consistency", label: "Consistent style language", category: "Polish" },
  { id: "polish_aesthetic", label: "Overall aesthetic is strong", category: "Polish" },
]

const scoreMax = scoreQuestions.length

const pageMeta = {
  runner: {
    title: "Runner",
    description: "Launch benchmarks and review live output.",
  },
  specs: {
    title: "Specs",
    description: "Benchmark prompts and requirements.",
  },
  models: {
    title: "Models",
    description: "Token usage and cost tracking.",
  },
  scoring: {
    title: "Scoring",
    description: "Score runs with a 20-point checklist.",
  },
  leaderboard: {
    title: "Leaderboard",
    description: "Average scores across models.",
  },
}

function classNames(...values) {
  return values.filter(Boolean).join(" ")
}

function buildPreviewDoc(html) {
  if (!html) return ""
  const trimmed = html.trim()
  if (!trimmed) return ""
  const hasTailwind = /cdn\.tailwindcss\.com/i.test(trimmed)
  if (hasTailwind) return trimmed
  if (/<head[\s>]/i.test(trimmed)) {
    return trimmed.replace(
      /<head[^>]*>/i,
      (match) => `${match}\n<script src="https://cdn.tailwindcss.com"></script>`
    )
  }
  if (/<html[\s>]/i.test(trimmed)) {
    return trimmed.replace(
      /<html[^>]*>/i,
      (match) => `${match}\n<head><script src="https://cdn.tailwindcss.com"></script></head>`
    )
  }
  return `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>${trimmed}</body></html>`
}

function getEmptyScoreDraft() {
  const answers = {}
  scoreQuestions.forEach((question) => {
    answers[question.id] = false
  })
  return { answers, notes: "" }
}

function totalScore(draft) {
  return scoreQuestions.reduce((sum, question) => sum + (draft.answers[question.id] ? 1 : 0), 0)
}

export default function App() {
  const [activePage, setActivePage] = useState("runner")
  const [runs, setRuns] = useState([])
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState(benchmarks[0]?.id)
  const [selectedProvider, setSelectedProvider] = useState("openai")
  const [selectedModel, setSelectedModel] = useState("")
  const [modelOptions, setModelOptions] = useState({})
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState("")
  const [prompt, setPrompt] = useState(benchmarks[0]?.promptTemplate || "")
  const [systemPrompt, setSystemPrompt] = useState(
    "Return only a complete HTML document. Do not include Markdown or explanations."
  )
  const [temperature, setTemperature] = useState(tempDefaults.openai)
  const [maxTokens, setMaxTokens] = useState("")
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewRunId, setPreviewRunId] = useState(null)
  const [liveOutput, setLiveOutput] = useState("")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runQueueCount, setRunQueueCount] = useState(0)
  const [runErrors, setRunErrors] = useState([])
  const [currentRunTitle, setCurrentRunTitle] = useState("")
  const [selectedRun, setSelectedRun] = useState(null)
  const [scoreDraft, setScoreDraft] = useState(getEmptyScoreDraft)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeys, setApiKeys] = useState(() => {
    const stored = localStorage.getItem("ui-bench-keys")
    return stored ? JSON.parse(stored) : {}
  })
  const [preferences, setPreferences] = useState(() => {
    const stored = localStorage.getItem("ui-bench-preferences")
    return stored ? JSON.parse(stored) : { provider: "openai", models: {} }
  })
  const [modelPricing, setModelPricing] = useState(() => {
    const stored = localStorage.getItem("ui-bench-pricing")
    return stored ? JSON.parse(stored) : {}
  })

  const selectedBenchmark = benchmarks.find((item) => item.id === selectedBenchmarkId)

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data) => setRuns(data.runs || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (preferences?.provider) {
      setSelectedProvider(preferences.provider)
    }
  }, [])

  useEffect(() => {
    if (!selectedBenchmark) return
    setPrompt(selectedBenchmark.promptTemplate)
  }, [selectedBenchmarkId])

  async function fetchModels(provider) {
    setModelLoading(true)
    setModelError("")
    const providerKey = apiKeys?.[provider]
    if (!providerKey) {
      setModelOptions((prev) => ({ ...prev, [provider]: [] }))
      setModelError("Add an API key to load models, or enter a model ID manually.")
      setModelLoading(false)
      return
    }
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: providerKey }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load models")
      }
      const data = await response.json()
      const list = data.models || []
      setModelOptions((prev) => ({ ...prev, [provider]: list }))
      if (!selectedModel && list.length > 0) {
        const preferred = preferences?.models?.[provider]
        setSelectedModel(preferred || list[0])
      }
    } catch (error) {
      setModelError(error.message)
      setModelOptions((prev) => ({ ...prev, [provider]: [] }))
    } finally {
      setModelLoading(false)
    }
  }

  function handleRefreshModels() {
    fetchModels(selectedProvider)
  }

  useEffect(() => {
    setTemperature(tempDefaults[selectedProvider])
    const preferredModel = preferences?.models?.[selectedProvider]
    if (preferredModel) {
      setSelectedModel(preferredModel)
    }
    const preferredTemp = preferences?.temperatures?.[selectedProvider]
    if (typeof preferredTemp === "number") {
      setTemperature(preferredTemp)
    }
    setPreferences((prev) => {
      const next = { ...prev, provider: selectedProvider }
      localStorage.setItem("ui-bench-preferences", JSON.stringify(next))
      return next
    })
    fetchModels(selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    if (apiKeys?.[selectedProvider]) {
      fetchModels(selectedProvider)
    }
  }, [apiKeys])

  useEffect(() => {
    if (!selectedModel) return
    setPreferences((prev) => {
      const next = {
        ...prev,
        provider: selectedProvider,
        models: { ...(prev?.models || {}), [selectedProvider]: selectedModel },
      }
      localStorage.setItem("ui-bench-preferences", JSON.stringify(next))
      return next
    })
  }, [selectedModel])

  useEffect(() => {
    if (typeof temperature !== "number") return
    setPreferences((prev) => {
      const next = {
        ...prev,
        temperatures: { ...(prev?.temperatures || {}), [selectedProvider]: temperature },
      }
      localStorage.setItem("ui-bench-preferences", JSON.stringify(next))
      return next
    })
  }, [temperature])

  useEffect(() => {
    if (!selectedRun?.id) return
    fetch(`/api/runs/${selectedRun.id}/html`)
      .then((res) => res.text())
      .then((html) => {
        setPreviewHtml(html)
        setPreviewRunId(selectedRun.id)
      })
      .catch(() => {})
  }, [selectedRun])

  const leaderboard = useMemo(() => {
    const map = new Map()
    runs.forEach((run) => {
      if (typeof run.scoreSummary?.overall !== "number") return
      const key = `${run.provider}:${run.model}`
      const entry = map.get(key) || { provider: run.provider, model: run.model, scores: [] }
      entry.scores.push(run.scoreSummary.overall)
      map.set(key, entry)
    })
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        average: entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length,
        count: entry.scores.length,
      }))
      .sort((a, b) => b.average - a.average)
  }, [runs])

  const scoringQueue = useMemo(() => {
    const unscored = runs.filter((run) => typeof run.scoreSummary?.overall !== "number")
    const scored = runs.filter((run) => typeof run.scoreSummary?.overall === "number")
    return { unscored, scored }
  }, [runs])

  const modelsForProvider = modelOptions[selectedProvider] || []
  const totalRuns = runs.length
  const totalScored = scoringQueue.scored.length
  const totalUnscored = scoringQueue.unscored.length

  const scoreGroups = useMemo(() => {
    const groups = new Map()
    scoreQuestions.forEach((question) => {
      const list = groups.get(question.category) || []
      list.push(question)
      groups.set(question.category, list)
    })
    return Array.from(groups.entries())
  }, [])

  function saveApiKeys(next) {
    setApiKeys(next)
    localStorage.setItem("ui-bench-keys", JSON.stringify(next))
  }

  async function runBenchmark(benchmark, promptOverride) {
    if (!selectedModel) {
      throw new Error("Model ID is required")
    }
    const basePrompt = promptOverride || benchmark.promptTemplate
    const runPrompt = `${basePrompt}\n\nReturn only HTML. Do not wrap in markdown. Use Tailwind CSS classes.`
    setLiveOutput("")
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 180000)

    let response
    try {
      response = await fetch("/api/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          prompt: runPrompt,
          systemPrompt,
          params: { temperature, maxTokens: maxTokens === "" ? null : Number(maxTokens) },
          benchmark: {
            id: benchmark.id,
            title: benchmark.title,
            category: benchmark.category,
          },
          apiKeys,
        }),
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const text = await response.text()
      let message = "Run failed"
      try {
        const data = JSON.parse(text)
        message = data.error || message
      } catch {
        if (text) message = text
        else if (response.statusText) message = response.statusText
      }
      throw new Error(`${message} (HTTP ${response.status})`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finalPayload = null

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() || ""
      for (const part of parts) {
        const line = part.split("\n").find((item) => item.startsWith("data:"))
        if (!line) continue
        const data = line.replace("data:", "").trim()
        if (!data) continue
        let payload
        try {
          payload = JSON.parse(data)
        } catch {
          continue
        }
        if (payload.type === "delta") {
          setLiveOutput((prev) => prev + payload.text)
        }
        if (payload.type === "done") {
          finalPayload = payload
        }
        if (payload.type === "error") {
          throw new Error(payload.message || "Run failed")
        }
      }
    }

    if (!finalPayload) {
      throw new Error("Run finished without output")
    }
    return finalPayload
  }

  async function handleRunSingle() {
    if (!selectedBenchmark) return
    setIsRunning(true)
    setRunErrors([])
    try {
      setCurrentRunTitle(selectedBenchmark.title)
      const data = await runBenchmark(selectedBenchmark, prompt)
      setRuns((prev) => [data.entry, ...prev])
      setPreviewHtml(data.html)
      setPreviewRunId(data.entry.id)
      setSelectedRun(data.entry)
    } catch (error) {
      alert(error.message)
    } finally {
      setCurrentRunTitle("")
      setIsRunning(false)
    }
  }

  async function handleRunAll() {
    if (!selectedModel) {
      alert("Model ID is required")
      return
    }
    setIsRunning(true)
    setRunErrors([])
    setRunQueueCount(benchmarks.length)

    const queue = [...benchmarks]
    for (const benchmark of queue) {
      setCurrentRunTitle(benchmark.title)
      try {
        const data = await runBenchmark(benchmark)
        setRuns((prev) => [data.entry, ...prev])
        setPreviewHtml(data.html)
        setPreviewRunId(data.entry.id)
        setSelectedRun(data.entry)
      } catch (error) {
        setRunErrors((prev) => [
          ...prev,
          {
            id: benchmark.id,
            title: benchmark.title,
            message: error.message || "Run failed",
          },
        ])
      } finally {
        setRunQueueCount((count) => Math.max(count - 1, 0))
      }
    }
    setCurrentRunTitle("")
    setIsRunning(false)
  }

  async function handleSaveScore() {
    if (!selectedRun) return
    const score = {
      ...scoreDraft.answers,
      notes: scoreDraft.notes,
      overall: totalScore(scoreDraft),
      maxScore: scoreMax,
    }
    const response = await fetch(`/api/runs/${selectedRun.id}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(score),
    })
    if (!response.ok) {
      alert("Failed to save score")
      return
    }
    const { summary } = await response.json()
    setRuns((prev) =>
      prev.map((run) => (run.id === selectedRun.id ? { ...run, scoreSummary: summary } : run))
    )
  }

  async function handleDeleteRun(runId) {
    const confirmed = window.confirm("Delete this run and its files?")
    if (!confirmed) return
    const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" })
    if (!response.ok) {
      alert("Failed to delete run")
      return
    }
    setRuns((prev) => prev.filter((run) => run.id !== runId))
    if (selectedRun?.id === runId) {
      setSelectedRun(null)
      setPreviewHtml("")
      setPreviewRunId(null)
    }
  }

  function handleSelectRun(run) {
    setSelectedRun(run)
    setScoreDraft(getEmptyScoreDraft())
  }

  const layoutTabs = [
    { id: "runner", label: "Runner" },
    { id: "specs", label: "Specs" },
    { id: "models", label: "Models" },
    { id: "scoring", label: "Scoring" },
    { id: "leaderboard", label: "Leaderboard" },
  ]

  const modelStats = useMemo(() => {
    const totalBenchmarks = benchmarks.length
    const map = new Map()

    runs.forEach((run) => {
      const key = `${run.provider}:${run.model}`
      const entry = map.get(key) || {
        provider: run.provider,
        model: run.model,
        runCount: 0,
        benchmarksCompleted: new Set(),
        inputTokens: 0,
        outputTokens: 0,
        hasTokenData: false,
        totalLatencyMs: 0,
      }

      entry.runCount += 1
      if (run.benchmark?.id) {
        entry.benchmarksCompleted.add(run.benchmark.id)
      }
      entry.totalLatencyMs += run.latencyMs || 0

      if (run.tokenUsage) {
        entry.hasTokenData = true
        if (run.tokenUsage.prompt_tokens !== undefined) {
          entry.inputTokens += run.tokenUsage.prompt_tokens || 0
          entry.outputTokens += run.tokenUsage.completion_tokens || 0
        }
        if (run.tokenUsage.input_tokens !== undefined) {
          entry.inputTokens += run.tokenUsage.input_tokens || 0
          entry.outputTokens += run.tokenUsage.output_tokens || 0
        }
      }

      map.set(key, entry)
    })

    return Array.from(map.values()).map((entry) => ({
      ...entry,
      benchmarksCompleted: entry.benchmarksCompleted.size,
      benchmarksRemaining: totalBenchmarks - entry.benchmarksCompleted.size,
      totalBenchmarks,
      avgLatencyMs: entry.runCount > 0 ? Math.round(entry.totalLatencyMs / entry.runCount) : 0,
    }))
  }, [runs])

  const maxTokenTotal = Math.max(
    ...modelStats.map((stat) => stat.inputTokens + stat.outputTokens),
    1
  )
  const maxLeaderboardScore = Math.max(...leaderboard.map((entry) => entry.average), 1)

  function saveModelPricing(model, pricing) {
    const next = { ...modelPricing, [model]: pricing }
    setModelPricing(next)
    localStorage.setItem("ui-bench-pricing", JSON.stringify(next))
  }

  function calculateCost(model, inputTokens, outputTokens) {
    const pricing = modelPricing[model]
    if (!pricing?.inputPrice || !pricing?.outputPrice) return null
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice
    return inputCost + outputCost
  }

  const activeMeta = pageMeta[activePage] || pageMeta.runner

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-16 right-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute top-1/3 -left-16 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
      </div>

      <aside className="sidebar hidden flex-col lg:flex">
        <div className="flex h-full flex-col px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-semibold text-white">
              N
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">NovaBench</p>
              <p className="text-sm text-slate-300">AI UI Benchmark</p>
            </div>
          </div>

          <div className="mt-8 space-y-2">
            {layoutTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActivePage(tab.id)}
                className={classNames(
                  "nav-item",
                  activePage === tab.id ? "nav-item-active" : "nav-item-inactive"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-3">
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-3 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Provider</span>
                <span className="badge badge-slate">{selectedProvider}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Model</span>
                <span className="truncate text-slate-200">{selectedModel || "-"}</span>
              </div>
            </div>
            <button onClick={() => setShowSettings(true)} className="btn-secondary w-full">
              API Keys
            </button>
          </div>
        </div>
      </aside>

      <div className="main-content">
        <header className="sticky top-0 z-20 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="lg:hidden">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">NovaBench</p>
              <p className="text-sm text-slate-200">AI UI Benchmark</p>
            </div>
            <div className="hidden lg:block">
              <h1 className="font-display text-xl text-slate-100">{activeMeta.title}</h1>
              <p className="text-xs text-slate-500">{activeMeta.description}</p>
            </div>
            <div className="flex items-center gap-3">
              {isRunning && (
                <div className="running-indicator rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs text-violet-300">
                  Running {currentRunTitle ? `- ${currentRunTitle}` : ""}
                </div>
              )}
              <button onClick={() => setShowSettings(true)} className="btn-ghost lg:hidden">
                API Keys
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto px-6 pb-4 lg:hidden">
            {layoutTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActivePage(tab.id)}
                className={classNames(
                  "nav-item whitespace-nowrap",
                  activePage === tab.id ? "nav-item-active" : "nav-item-inactive"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-6">
          {activePage === "runner" && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="font-display text-2xl text-white">Run Benchmarks</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Launch NovaBench prompts, watch the stream, and compare outputs.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="stat-card">
                    <p className="label">Total Runs</p>
                    <p className="mt-2 text-lg font-semibold text-white">{totalRuns}</p>
                  </div>
                  <div className="stat-card">
                    <p className="label">Unscored</p>
                    <p className="mt-2 text-lg font-semibold text-white">{totalUnscored}</p>
                  </div>
                  <div className="stat-card">
                    <p className="label">Scored</p>
                    <p className="mt-2 text-lg font-semibold text-white">{totalScored}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="space-y-4 min-w-0">
                  <div className="card p-4">
                    <p className="label">Benchmark</p>
                    <select
                      value={selectedBenchmarkId}
                      onChange={(event) => setSelectedBenchmarkId(event.target.value)}
                      className="select mt-3"
                    >
                      {benchmarks.map((benchmark) => (
                        <option key={benchmark.id} value={benchmark.id}>
                          {benchmark.title}
                        </option>
                      ))}
                    </select>
                    <div className="mt-4">
                      <p className="label">Prompt</p>
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={6}
                        className="input mt-2"
                      />
                    </div>
                    <div className="mt-4">
                      <p className="label">System Prompt</p>
                      <textarea
                        value={systemPrompt}
                        onChange={(event) => setSystemPrompt(event.target.value)}
                        rows={3}
                        className="input mt-2"
                      />
                    </div>
                  </div>

                  <div className="card p-4">
                    <p className="label">Provider</p>
                    <div className="mt-3 grid gap-3">
                      <select
                        value={selectedProvider}
                        onChange={(event) => setSelectedProvider(event.target.value)}
                        className="select"
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        className="select"
                      >
                        {modelsForProvider.length === 0 && (
                          <option value="">No models loaded</option>
                        )}
                        {modelsForProvider.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <input
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        placeholder="Model ID"
                        className="input"
                      />
                      <button onClick={handleRefreshModels} className="btn-secondary">
                        Refresh Models
                      </button>
                      {modelLoading && <p className="text-xs text-slate-500">Loading models...</p>}
                      {modelError && <p className="text-xs text-amber-400">{modelError}</p>}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <label className="space-y-1">
                        <span className="label">Temperature</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="1.5"
                          value={temperature}
                          onChange={(event) => setTemperature(Number(event.target.value))}
                          className="input"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="label">Max Tokens</span>
                        <input
                          type="number"
                          min="200"
                          max="8000"
                          value={maxTokens}
                          onChange={(event) => setMaxTokens(event.target.value)}
                          placeholder="Auto"
                          className="input"
                        />
                        <p className="text-[11px] text-slate-500">Leave empty to let the provider decide.</p>
                      </label>
                    </div>
                    <div className="mt-4 flex gap-3">
                      <button onClick={handleRunSingle} disabled={isRunning} className="btn-primary flex-1">
                        Run Selected
                      </button>
                      <button onClick={handleRunAll} disabled={isRunning} className="btn-secondary flex-1">
                        Run All
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Runs sequentially and saves all outputs for scoring later.
                    </p>
                    {runErrors.length > 0 && (
                      <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">
                        <p className="font-semibold">Failed runs: {runErrors.length}</p>
                        <div className="mt-2 max-h-32 space-y-1 overflow-auto">
                          {runErrors.map((error) => (
                            <div key={error.id}>
                              {error.title}: {error.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="card p-4">
                    <div className="flex items-center justify-between">
                      <p className="label">History</p>
                      <span className="badge badge-slate">{runs.length}</span>
                    </div>
                    <div className="mt-3 max-h-[320px] space-y-2 overflow-auto">
                      {runs.length === 0 && <p className="text-sm text-slate-500">No runs yet.</p>}
                      {runs.map((run) => {
                        const hasScore = typeof run.scoreSummary?.overall === "number"
                        return (
                          <div
                            key={run.id}
                            className={classNames(
                              "rounded-xl border px-3 py-2 text-left text-sm",
                              selectedRun?.id === run.id
                                ? "border-violet-400/60 bg-violet-500/10"
                                : "border-slate-800/70"
                            )}
                          >
                            <button onClick={() => handleSelectRun(run)} className="w-full text-left">
                              <div className="flex items-center justify-between">
                                <span>{run.benchmark?.title || "Untitled"}</span>
                                <span className="text-xs text-slate-400">{run.provider}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                                <span className="truncate">{run.model}</span>
                                <span>{hasScore ? `Score ${run.scoreSummary.overall}/${scoreMax}` : "Unscored"}</span>
                              </div>
                            </button>
                            <div className="mt-2 flex justify-end">
                              <button
                                onClick={() => handleDeleteRun(run.id)}
                                className="text-xs text-rose-300 hover:text-rose-200"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 min-w-0">
                  <div className="card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="label">Preview</p>
                        <h3 className="font-display text-lg text-white">Rendered Output</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {previewRunId && (
                          <a
                            href={`/api/runs/${previewRunId}/html?raw=1`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary"
                          >
                            View HTML
                          </a>
                        )}
                        <button onClick={() => setIsFullscreen(true)} className="btn-secondary">
                          Fullscreen
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 h-[360px] overflow-hidden rounded-xl border border-slate-800 bg-white">
                      {previewHtml ? (
                        <iframe title="preview" srcDoc={buildPreviewDoc(previewHtml)} className="h-full w-full" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-500">
                          No preview yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card p-4 live-output-container">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="label">Live Output</p>
                        <p className="text-xs text-slate-500">Streaming text stays within this pane.</p>
                      </div>
                      <span className="badge badge-purple">Fixed Width</span>
                    </div>
                    <pre className="mt-3 max-h-60 overflow-auto text-xs text-slate-300">
                      {liveOutput || "Streaming output will appear here."}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePage === "specs" && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-2xl text-white">Benchmark Specs</h2>
                <p className="mt-1 text-sm text-slate-400">Reference the objectives and constraints.</p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                {benchmarks.map((benchmark) => (
                  <div key={benchmark.id} className="card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="label">{benchmark.category}</p>
                        <h3 className="font-display text-lg text-white">{benchmark.title}</h3>
                      </div>
                      <span className="badge badge-slate">{benchmark.tags.join(" ")}</span>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">{benchmark.objective}</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="label">Required</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-300">
                          {benchmark.required.map((item) => (
                            <li key={item}>- {item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="label">Constraints</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-300">
                          {benchmark.constraints.map((item) => (
                            <li key={item}>- {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="label">Output</p>
                        <p className="mt-2 text-sm text-slate-300">{benchmark.output}</p>
                      </div>
                      <div>
                        <p className="label">Stretch</p>
                        <ul className="mt-2 space-y-1 text-sm text-slate-300">
                          {benchmark.stretch.map((item) => (
                            <li key={item}>- {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/60 p-3 text-xs text-slate-400">
                      {benchmark.rawPrompt}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePage === "models" && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-2xl text-white">Model Telemetry</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Track completion progress, tokens, and estimated cost by model.
                </p>
              </div>

              {modelStats.length === 0 ? (
                <div className="card p-8 text-center">
                  <p className="text-slate-500">No runs yet. Run benchmarks to see model stats.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {modelStats.map((stat) => {
                    const modelKey = `${stat.provider}:${stat.model}`
                    const pricing = modelPricing[stat.model] || {}
                    const cost = calculateCost(stat.model, stat.inputTokens, stat.outputTokens)
                    const tokenTotal = stat.inputTokens + stat.outputTokens
                    const inputPct = tokenTotal ? (stat.inputTokens / tokenTotal) * 100 : 0
                    const outputPct = tokenTotal ? (stat.outputTokens / tokenTotal) * 100 : 0
                    const volumePct = tokenTotal ? (tokenTotal / maxTokenTotal) * 100 : 0
                    const completionPct = stat.totalBenchmarks
                      ? (stat.benchmarksCompleted / stat.totalBenchmarks) * 100
                      : 0

                    return (
                      <div key={modelKey} className="card p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="label">{stat.provider}</p>
                            <h3 className="font-display text-xl text-white">{stat.model}</h3>
                          </div>
                          <div className="min-w-[180px] text-left lg:text-right">
                            <p className="text-2xl font-semibold text-white">
                              {stat.benchmarksCompleted}/{stat.totalBenchmarks}
                            </p>
                            <p className="text-xs text-slate-500">benchmarks completed</p>
                            {stat.benchmarksRemaining > 0 && (
                              <p className="mt-1 text-xs text-amber-400">
                                {stat.benchmarksRemaining} remaining
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="mt-4">
                          <p className="label">Completion</p>
                          <div className="progress-bar mt-2">
                            <div className="progress-fill" style={{ width: `${completionPct}%` }} />
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="stat-card">
                            <p className="label">Total Runs</p>
                            <p className="mt-2 text-lg font-semibold text-white">{stat.runCount}</p>
                          </div>
                          <div className="stat-card">
                            <p className="label">Avg Latency</p>
                            <p className="mt-2 text-lg font-semibold text-white">
                              {stat.avgLatencyMs > 0 ? `${(stat.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                            </p>
                          </div>
                          <div className="stat-card">
                            <p className="label">Input Tokens</p>
                            <p className="mt-2 text-lg font-semibold text-white">
                              {stat.hasTokenData ? stat.inputTokens.toLocaleString() : "-"}
                            </p>
                          </div>
                          <div className="stat-card">
                            <p className="label">Output Tokens</p>
                            <p className="mt-2 text-lg font-semibold text-white">
                              {stat.hasTokenData ? stat.outputTokens.toLocaleString() : "-"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
                            <p className="label">Token Mix</p>
                            <div className="mt-3">
                              <div className="progress-bar">
                                <div className="flex h-full">
                                  <div
                                    className="h-full bg-violet-500"
                                    style={{ width: `${inputPct}%` }}
                                  />
                                  <div
                                    className="h-full bg-cyan-500"
                                    style={{ width: `${outputPct}%` }}
                                  />
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                                <span>Input</span>
                                <span>Output</span>
                              </div>
                            </div>
                            <div className="mt-4">
                              <p className="label">Token Volume</p>
                              <div className="progress-bar mt-2">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-500"
                                  style={{ width: `${volumePct}%` }}
                                />
                              </div>
                              <p className="mt-2 text-xs text-slate-500">
                                {stat.hasTokenData ? tokenTotal.toLocaleString() : "No token data"}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
                            <p className="label">Pricing (per 1M tokens)</p>
                            <div className="mt-3 grid gap-3">
                              <label className="space-y-1">
                                <span className="text-xs text-slate-400">Input Price ($)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="e.g. 0.15"
                                  value={pricing.inputPrice || ""}
                                  onChange={(event) =>
                                    saveModelPricing(stat.model, {
                                      ...pricing,
                                      inputPrice: event.target.value ? Number(event.target.value) : null,
                                    })
                                  }
                                  className="input"
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs text-slate-400">Output Price ($)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="e.g. 0.60"
                                  value={pricing.outputPrice || ""}
                                  onChange={(event) =>
                                    saveModelPricing(stat.model, {
                                      ...pricing,
                                      outputPrice: event.target.value ? Number(event.target.value) : null,
                                    })
                                  }
                                  className="input"
                                />
                              </label>
                              <div>
                                <span className="text-xs text-slate-400">Estimated Cost</span>
                                <div className="mt-1 flex h-[40px] items-center rounded-xl border border-slate-700/60 bg-slate-900/60 px-3">
                                  {stat.hasTokenData && cost !== null ? (
                                    <span className="text-lg font-semibold text-emerald-400">
                                      ${cost.toFixed(4)}
                                    </span>
                                  ) : stat.hasTokenData ? (
                                    <span className="text-sm text-slate-500">Set pricing</span>
                                  ) : (
                                    <span className="text-sm text-slate-500">No token data</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {activePage === "scoring" && (
            <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <div className="space-y-4">
                <div className="card p-4">
                  <p className="label">Scoring Queue</p>
                  <div className="mt-3 space-y-2">
                    {scoringQueue.unscored.length === 0 && (
                      <p className="text-sm text-slate-500">No unscored runs.</p>
                    )}
                    {scoringQueue.unscored.map((run) => (
                      <div key={run.id} className="card-hover rounded-xl border border-slate-800/70 px-3 py-2">
                        <button onClick={() => handleSelectRun(run)} className="w-full text-left">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">{run.benchmark?.title || "Untitled"}</span>
                            <span className="text-xs text-slate-400">{run.provider}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{run.model}</div>
                        </button>
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => handleDeleteRun(run.id)}
                            className="text-xs text-rose-300 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-4">
                  <p className="label">Scored Runs</p>
                  <div className="mt-3 space-y-2">
                    {scoringQueue.scored.length === 0 && (
                      <p className="text-sm text-slate-500">No scored runs yet.</p>
                    )}
                    {scoringQueue.scored.map((run) => (
                      <div key={run.id} className="card-hover rounded-xl border border-slate-800/70 px-3 py-2">
                        <button onClick={() => handleSelectRun(run)} className="w-full text-left">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">{run.benchmark?.title || "Untitled"}</span>
                            <span className="text-xs text-slate-400">
                              {typeof run.scoreSummary?.overall === "number"
                                ? `${run.scoreSummary.overall}/${scoreMax}`
                                : "-"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{run.model}</div>
                        </button>
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => handleDeleteRun(run.id)}
                            className="text-xs text-rose-300 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="label">Preview</p>
                      <h3 className="font-display text-lg text-white">Selected Run</h3>
                    </div>
                    <button onClick={() => setIsFullscreen(true)} className="btn-secondary">
                      Fullscreen
                    </button>
                  </div>
                  <div className="mt-4 h-[320px] overflow-hidden rounded-xl border border-slate-800 bg-white">
                    {previewHtml ? (
                      <iframe title="score-preview" srcDoc={buildPreviewDoc(previewHtml)} className="h-full w-full" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Select a run to preview.
                      </div>
                    )}
                  </div>
                </div>

                <div className="card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="label">Scoring Checklist</p>
                      <p className="text-xs text-slate-500">20 binary checks, 1 point each.</p>
                    </div>
                    <div className="badge badge-purple">
                      {totalScore(scoreDraft)}/{scoreMax}
                    </div>
                  </div>

                  {selectedRun ? (
                    <div className="mt-4 space-y-4">
                      {scoreGroups.map(([category, questions]) => (
                        <div key={category} className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-3">
                          <p className="label">{category}</p>
                          <div className="mt-3 space-y-2">
                            {questions.map((question) => (
                              <label key={question.id} className="flex items-center justify-between text-sm">
                                <span className="text-slate-300">{question.label}</span>
                                <input
                                  type="checkbox"
                                  checked={scoreDraft.answers[question.id]}
                                  onChange={(event) =>
                                    setScoreDraft((prev) => ({
                                      ...prev,
                                      answers: {
                                        ...prev.answers,
                                        [question.id]: event.target.checked,
                                      },
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-500"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      <textarea
                        rows={3}
                        value={scoreDraft.notes}
                        onChange={(event) =>
                          setScoreDraft((prev) => ({
                            ...prev,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Notes"
                        className="input"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-400">
                          Total Score: {totalScore(scoreDraft)}/{scoreMax}
                        </span>
                        <button onClick={handleSaveScore} className="btn-primary">
                          Save Score
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Select a run to score.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePage === "leaderboard" && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-2xl text-white">Leaderboard</h2>
                <p className="mt-1 text-sm text-slate-400">Average overall score per model.</p>
              </div>

              <div className="card p-5">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-slate-500">Score runs to populate the leaderboard.</p>
                ) : (
                  <div className="space-y-4">
                    {leaderboard.map((entry) => {
                      const barWidth = (entry.average / maxLeaderboardScore) * 100
                      return (
                        <div key={`${entry.provider}-${entry.model}`} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div>
                              <p className="font-medium text-slate-200">{entry.model}</p>
                              <p className="text-xs text-slate-500 capitalize">{entry.provider}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-white">
                                {entry.average.toFixed(1)}/{scoreMax}
                              </p>
                              <p className="text-xs text-slate-500">{entry.count} runs</p>
                            </div>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${barWidth}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-white">API Keys</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400">
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {providers.map((provider) => (
                <label key={provider.id} className="block text-sm">
                  <span className="label">{provider.label}</span>
                  <input
                    type="password"
                    value={apiKeys[provider.id] || ""}
                    onChange={(event) =>
                      saveApiKeys({
                        ...apiKeys,
                        [provider.id]: event.target.value,
                      })
                    }
                    className="input mt-2"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
            <div>
              <p className="label">Fullscreen Preview</p>
              <p className="text-sm text-slate-300">Run ID: {previewRunId || "-"}</p>
            </div>
            <button onClick={() => setIsFullscreen(false)} className="btn-secondary">
              Close
            </button>
          </div>
          <div className="h-[calc(100vh-64px)]">
            {previewHtml ? (
              <iframe title="fullscreen-preview" srcDoc={buildPreviewDoc(previewHtml)} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-500">No preview.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
