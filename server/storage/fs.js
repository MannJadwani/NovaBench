import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"

const dataRoot = path.resolve(process.cwd(), "data")
const indexPath = path.join(dataRoot, "index.json")

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function readIndex() {
  try {
    const raw = await fs.readFile(indexPath, "utf-8")
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === "ENOENT") {
      return []
    }
    throw error
  }
}

async function writeIndex(entries) {
  await ensureDir(dataRoot)
  await fs.writeFile(indexPath, JSON.stringify(entries, null, 2))
}

function buildRunPath(createdAt, runId) {
  const year = String(createdAt.getFullYear())
  const month = String(createdAt.getMonth() + 1).padStart(2, "0")
  const day = String(createdAt.getDate()).padStart(2, "0")
  return path.join("runs", year, month, day, runId)
}

export async function createRun({
  provider,
  model,
  prompt,
  response,
  html,
  params,
  benchmark,
  latencyMs,
  tokenUsage,
}) {
  const createdAt = new Date()
  const runId = randomUUID()
  const runPath = buildRunPath(createdAt, runId)
  const fullRunPath = path.join(dataRoot, runPath)

  await ensureDir(fullRunPath)

  const meta = {
    id: runId,
    createdAt: createdAt.toISOString(),
    provider,
    model,
    benchmark,
    latencyMs,
    tokenUsage,
    params,
    path: runPath,
  }

  await Promise.all([
    fs.writeFile(path.join(fullRunPath, "prompt.json"), JSON.stringify({ prompt, params, benchmark }, null, 2)),
    fs.writeFile(path.join(fullRunPath, "response.json"), JSON.stringify(response, null, 2)),
    fs.writeFile(path.join(fullRunPath, "meta.json"), JSON.stringify(meta, null, 2)),
    fs.writeFile(path.join(fullRunPath, "artifact.html"), html),
  ])

  const index = await readIndex()
  const entry = {
    id: runId,
    createdAt: meta.createdAt,
    provider,
    model,
    benchmark,
    latencyMs,
    tokenUsage,
    params,
    path: runPath,
    scoreSummary: null,
  }
  index.unshift(entry)
  await writeIndex(index)

  return entry
}

export async function listRuns() {
  return readIndex()
}

export async function getRunEntry(runId) {
  const index = await readIndex()
  const entry = index.find((item) => item.id === runId)
  return { index, entry }
}

export async function getRunHtml(runId) {
  const { entry } = await getRunEntry(runId)
  if (!entry) return null
  const htmlPath = path.join(dataRoot, entry.path, "artifact.html")
  return fs.readFile(htmlPath, "utf-8")
}

export async function deleteRun(runId) {
  const { index, entry } = await getRunEntry(runId)
  if (!entry) return null
  const runDir = path.join(dataRoot, entry.path)
  await fs.rm(runDir, { recursive: true, force: true })
  const nextIndex = index.filter((item) => item.id !== runId)
  await writeIndex(nextIndex)
  return entry
}

export async function saveScore(runId, score) {
  const { index, entry } = await getRunEntry(runId)
  if (!entry) return null
  const scorePath = path.join(dataRoot, entry.path, "score.json")
  const updatedScore = {
    ...score,
    updatedAt: new Date().toISOString(),
  }
  await fs.writeFile(scorePath, JSON.stringify(updatedScore, null, 2))

  const summary = {
    overall: score.overall,
    visual: score.visual_quality,
    fidelity: score.fidelity,
    usability: score.usability,
    completeness: score.completeness,
    correctness: score.correctness,
  }
  const nextIndex = index.map((item) =>
    item.id === runId ? { ...item, scoreSummary: summary } : item
  )
  await writeIndex(nextIndex)
  return summary
}
