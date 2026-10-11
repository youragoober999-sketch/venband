// Runs AI models in the browser with WebGPU (WebLLM), or streams from the
// server for cloud-brain AIs.
import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm'
import { getToken } from './api'

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

export type GpuInfo = { supported: boolean; reason?: string; description?: string; maxBufferGB?: number; shaderF16?: boolean }

let gpuCache: GpuInfo | null = null

export async function gpuInfo(): Promise<GpuInfo> {
  if (gpuCache) return gpuCache
  const nav = navigator as Navigator & { gpu?: { requestAdapter: (o?: unknown) => Promise<any> } }
  if (!nav.gpu) return (gpuCache = { supported: false, reason: 'This browser does not support WebGPU. Use a recent Chrome, Edge or Safari 26+, or switch this AI to a Cloud brain.' })
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return (gpuCache = { supported: false, reason: 'No compatible graphics card was found. Try updating your graphics drivers, or use a Cloud brain.' })
    const info = adapter.info || {}
    return (gpuCache = {
      supported: true,
      description: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU device',
      maxBufferGB: adapter.limits?.maxBufferSize ? adapter.limits.maxBufferSize / 1024 ** 3 : undefined,
      shaderF16: adapter.features?.has?.('shader-f16'),
    })
  } catch (e) {
    return (gpuCache = { supported: false, reason: `WebGPU failed to start: ${(e as Error).message}` })
  }
}

let engine: WebWorkerMLCEngine | null = null
let loadedModel = ''
let loading: Promise<WebWorkerMLCEngine> | null = null
let loadingModel = ''
const progressListeners = new Set<(r: InitProgressReport) => void>()

export function currentModel() {
  return loadedModel
}

export function onProgress(fn: (r: InitProgressReport) => void) {
  progressListeners.add(fn)
  return () => {
    progressListeners.delete(fn)
  }
}

/** Downloads (first time only, then cached) and starts a model. */
export async function loadModel(modelId: string): Promise<WebWorkerMLCEngine> {
  if (engine && loadedModel === modelId) return engine
  if (loading && loadingModel === modelId) return loading
  const webllm = await import('@mlc-ai/web-llm')
  const report = (r: InitProgressReport) => progressListeners.forEach((l) => l(r))
  loadingModel = modelId
  loading = (async () => {
    if (!engine) {
      const worker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), { type: 'module' })
      engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: report })
    } else {
      engine.setInitProgressCallback(report)
      await engine.reload(modelId)
    }
    loadedModel = modelId
    return engine
  })()
  try {
    return await loading
  } finally {
    loading = null
    loadingModel = ''
  }
}

export async function isCached(modelId: string) {
  try {
    const webllm = await import('@mlc-ai/web-llm')
    return await webllm.hasModelInCache(modelId)
  } catch {
    return false
  }
}

export async function deleteCached(modelId: string) {
  const webllm = await import('@mlc-ai/web-llm')
  if (loadedModel === modelId && engine) {
    await engine.unload()
    loadedModel = ''
  }
  await webllm.deleteModelAllInfoInCache(modelId)
}

export async function stopGenerating() {
  try {
    await engine?.interruptGenerate()
  } catch {
    /* nothing running */
  }
}

/** Streams a reply from the in-browser model. */
export async function browserChat(modelId: string, messages: ChatMsg[], opts: { temperature: number; maxTokens: number; think?: boolean; onDelta: (full: string) => void }): Promise<string> {
  const e = await loadModel(modelId)
  const supportsThink = /qwen3|deepseek-r1/i.test(modelId)
  const stream = await e.chat.completions.create({
    messages,
    stream: true,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    ...(supportsThink && /qwen3/i.test(modelId) ? { extra_body: { enable_thinking: !!opts.think } } : {}),
  })
  let full = ''
  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta?.content
    if (d) {
      full += d
      opts.onDelta(full)
    }
  }
  return full
}

/** One short non-streamed answer (used for the AI double-check). */
export async function browserComplete(modelId: string, messages: ChatMsg[]): Promise<string> {
  const e = await loadModel(modelId)
  const r = await e.chat.completions.create({
    messages, stream: false, temperature: 0, max_tokens: 200,
    ...(/qwen3/i.test(modelId) ? { extra_body: { enable_thinking: false } } : {}),
  })
  return r.choices?.[0]?.message?.content || ''
}

/** Streams a cloud-brain answer from the server (Server-Sent Events). */
export async function cloudChat(aiId: string, messages: { role: string; content: string }[], onDelta: (full: string) => void, signal?: AbortSignal): Promise<{ text: string; blocked?: boolean; replace?: boolean; reason?: string }> {
  const res = await fetch(`/api/ais/${aiId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || `Request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^data:\s*/, '')
      buf = buf.slice(i + 2)
      if (!line) continue
      const ev = JSON.parse(line)
      if (ev.error) throw new Error(ev.error)
      if (ev.delta) {
        full += ev.delta
        onDelta(full)
      }
      if (ev.done) return { text: ev.replace || ev.blocked ? ev.text : full || ev.text, blocked: ev.blocked, replace: ev.replace, reason: ev.reason }
    }
  }
  return { text: full }
}
