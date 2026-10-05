export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export function downloadBlob(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Speaks text with the browser's speech synthesis (Read Output Aloud extension). */
export function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.slice(0, 1200))
  u.lang = document.documentElement.lang || 'en'
  window.speechSynthesis.speak(u)
}

let audioCtx: AudioContext | null = null
/** A short soft click for the Typing Sounds extension and UI feedback. */
export function click(freq = 1800, volume = 0.03, duration = 0.02) {
  try {
    audioCtx ||= new AudioContext()
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq + Math.random() * 200
    g.gain.value = volume
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration)
    o.connect(g).connect(audioCtx.destination)
    o.start()
    o.stop(audioCtx.currentTime + duration)
  } catch {
    /* audio unavailable */
  }
}

/** Celebratory confetti (Deploy Confetti extension). Skipped for reduced motion. */
export function confetti() {
  if (document.documentElement.dataset.motion === 'reduce') return
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
  canvas.width = innerWidth
  canvas.height = innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  const colors = ['#8b5cf6', '#22d3ee', '#22c55e', '#f59e0b', '#ec4899']
  const parts = Array.from({ length: 120 }, () => ({
    x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 2,
    r: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * Math.PI,
  }))
  let frame = 0
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const p of parts) {
      p.vy += 0.35
      p.x += p.vx
      p.y += p.vy
      p.a += 0.2
      ctx.fillStyle = p.c
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.a)
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r)
      ctx.restore()
    }
    if (++frame < 90) requestAnimationFrame(tick)
    else canvas.remove()
  }
  tick()
}
