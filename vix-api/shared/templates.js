// Starter projects offered when creating a new API.
import { languageById } from './languages.js'

const js = languageById('javascript')

const LEADERBOARD = `// Game leaderboard - works with Unity, Godot, Unreal, Roblox, GameMaker...
// POST /scores  {"player": "ana", "score": 1200}
// GET  /scores?limit=10
async function handler(req) {
  const board = (await vix.kv.get('scores')) || []

  if (req.method === 'POST') {
    const { player, score } = req.body || {}
    if (!player || typeof score !== 'number') {
      return { status: 400, body: { error: 'Send JSON like {"player": "ana", "score": 1200}' } }
    }
    const entry = { player: String(player).slice(0, 32), score, at: new Date().toISOString() }
    board.push(entry)
    board.sort((a, b) => b.score - a.score)
    await vix.kv.set('scores', board.slice(0, 100))
    return { status: 201, body: { ok: true, rank: board.indexOf(entry) + 1 } }
  }

  const limit = Math.min(Number(req.query.limit) || 10, 100)
  return { top: board.slice(0, limit), total: board.length }
}
`

const AI_TOOLS = `// Tools an AI assistant can call (ChatGPT Actions, Claude tool use, MCP, LangChain).
// GET /roll?dice=2d6      -> roll dice
// GET /convert?c=21       -> Celsius to Fahrenheit
// GET /note  POST /note   -> remember a note between conversations
async function handler(req) {
  const tool = req.params.tool

  if (tool === 'roll') {
    const m = /^(\\d{1,2})d(\\d{1,3})$/i.exec(req.query.dice || '1d6')
    if (!m) return { status: 400, body: { error: 'Use dice=NdM, e.g. 2d6' } }
    const rolls = Array.from({ length: +m[1] }, () => 1 + Math.floor(Math.random() * +m[2]))
    return { dice: req.query.dice || '1d6', rolls, total: rolls.reduce((a, b) => a + b, 0) }
  }

  if (tool === 'convert') {
    const c = Number(req.query.c)
    if (Number.isNaN(c)) return { status: 400, body: { error: 'Pass c=<celsius>' } }
    return { celsius: c, fahrenheit: Math.round((c * 9 / 5 + 32) * 100) / 100 }
  }

  if (tool === 'note') {
    if (req.method === 'POST') {
      await vix.kv.set('note', String(req.body?.text ?? ''))
      return { saved: true }
    }
    return { note: (await vix.kv.get('note')) || '' }
  }

  return { status: 404, body: { error: 'Unknown tool', tools: ['roll', 'convert', 'note'] } }
}
`

const CHAT = `// A tiny chat room / message board for multiplayer games and Discord bots.
// GET  /messages           -> latest 50 messages
// POST /messages {"user":"ana","text":"gg"}
async function handler(req) {
  const msgs = (await vix.kv.get('messages')) || []
  if (req.method === 'POST') {
    const user = String(req.body?.user || 'anon').slice(0, 24)
    const text = String(req.body?.text || '').slice(0, 500)
    if (!text) return { status: 400, body: { error: 'text is required' } }
    msgs.push({ id: vix.uuid(), user, text, at: new Date().toISOString() })
    await vix.kv.set('messages', msgs.slice(-200))
    return { status: 201, body: { ok: true } }
  }
  return { messages: msgs.slice(-50) }
}
`

const PROXY = `// Calls another API for you (keep its key secret with the Secrets extension).
// GET /weather?lat=52.52&lon=13.41
async function handler(req) {
  const lat = Number(req.query.lat ?? 52.52)
  const lon = Number(req.query.lon ?? 13.41)
  const res = await fetch(\`https://api.open-meteo.com/v1/forecast?latitude=\${lat}&longitude=\${lon}&current_weather=true\`)
  if (!res.ok) return { status: 502, body: { error: 'Weather service unavailable' } }
  const data = await res.json()
  return { location: { lat, lon }, weather: data.current_weather }
}
`

const README = (title) => `# ${title}

Built with **Vix Api**. Every endpoint below is live 24/7 - even when you close the site.

- Edit files on the left, press **Ctrl+S** to save and **Ctrl+Enter** to run in the sandbox.
- Open the **Endpoints** tab to map URLs to files.
- Open **Integrate** for copy-paste code for Unity, Godot, Unreal, Roblox, AI agents and more.
`

/** @type {{id:string,name:string,icon:string,description:string,files:{path:string,content:string,is_folder?:boolean}[],endpoints:{method:string,route:string,file_path:string,description:string,public?:boolean}[]}[]} */
export const TEMPLATES = [
  {
    id: 'hello-js', name: 'Hello API (JavaScript)', icon: '⚡', description: 'The fastest runtime: a JSON endpoint with a visit counter stored in the KV store.',
    files: [
      { path: 'src', content: '', is_folder: true },
      { path: 'src/hello.js', content: js.endpoint },
      { path: 'README.md', content: README('Hello API') },
    ],
    endpoints: [{ method: 'GET', route: '/hello', file_path: 'src/hello.js', description: 'Says hello and counts visits' }],
  },
  {
    id: 'leaderboard', name: 'Game Leaderboard', icon: '🏆', description: 'Submit and read high scores from Unity, Godot, Unreal, Roblox or any engine.',
    files: [
      { path: 'leaderboard.js', content: LEADERBOARD },
      { path: 'README.md', content: README('Game Leaderboard') },
    ],
    endpoints: [
      { method: 'GET', route: '/scores', file_path: 'leaderboard.js', description: 'Top scores' },
      { method: 'POST', route: '/scores', file_path: 'leaderboard.js', description: 'Submit a score' },
    ],
  },
  {
    id: 'ai-tools', name: 'AI Agent Tools', icon: '🤖', description: 'Endpoints shaped for AI tool calling, with an auto-generated OpenAPI spec.',
    files: [{ path: 'tools.js', content: AI_TOOLS }, { path: 'README.md', content: README('AI Agent Tools') }],
    endpoints: [
      { method: 'ANY', route: '/:tool', file_path: 'tools.js', description: 'roll, convert and note tools' },
    ],
  },
  {
    id: 'chat', name: 'Message Board', icon: '💬', description: 'A shared message feed for multiplayer lobbies and bots.',
    files: [{ path: 'messages.js', content: CHAT }],
    endpoints: [
      { method: 'GET', route: '/messages', file_path: 'messages.js', description: 'Latest messages' },
      { method: 'POST', route: '/messages', file_path: 'messages.js', description: 'Post a message' },
    ],
  },
  {
    id: 'proxy', name: 'Weather Proxy', icon: '🌦️', description: 'Calls another web API with fetch and reshapes the answer.',
    files: [{ path: 'weather.js', content: PROXY }],
    endpoints: [{ method: 'GET', route: '/weather', file_path: 'weather.js', description: 'Current weather for lat/lon' }],
  },
  {
    id: 'polyglot', name: 'Polyglot (Python, Rust, Batch...)', icon: '🧬', description: 'One endpoint per language so you can compare them side by side.',
    files: [
      { path: 'python', content: '', is_folder: true },
      { path: 'python/main.py', content: languageById('python').endpoint },
      { path: 'rust', content: '', is_folder: true },
      { path: 'rust/main.rs', content: languageById('rust').endpoint },
      { path: 'batch', content: '', is_folder: true },
      { path: 'batch/hello.bat', content: languageById('batch').endpoint },
      { path: 'js', content: '', is_folder: true },
      { path: 'js/hello.js', content: js.endpoint },
      { path: 'data.json', content: '{\n  "languages": ["Python", "Rust", "Batch", "JavaScript"]\n}\n' },
    ],
    endpoints: [
      { method: 'GET', route: '/python', file_path: 'python/main.py', description: 'Python endpoint' },
      { method: 'GET', route: '/rust', file_path: 'rust/main.rs', description: 'Rust endpoint' },
      { method: 'GET', route: '/batch', file_path: 'batch/hello.bat', description: 'Batch endpoint' },
      { method: 'GET', route: '/js', file_path: 'js/hello.js', description: 'JavaScript endpoint' },
      { method: 'GET', route: '/data', file_path: 'data.json', description: 'Static JSON file' },
    ],
  },
  {
    id: 'blank', name: 'Blank project', icon: '📄', description: 'An empty project. Bring your own files.',
    files: [{ path: 'README.md', content: README('My API') }],
    endpoints: [],
  },
]

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]
}
