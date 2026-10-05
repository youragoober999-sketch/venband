// The extension catalog. "api" extensions change how a hosted API behaves and are
// enabled per API (settings live in vix_apis.extensions). "editor" extensions
// change the workspace and are enabled per account (vix_users.settings).

/** @typedef {{key:string,label:string,type:'number'|'text'|'boolean'|'select'|'list',default:any,options?:string[],min?:number,max?:number,help?:string}} ExtField */
/** @typedef {{id:string,scope:'api'|'editor',name:string,icon:string,category:string,description:string,fields?:ExtField[],recommended?:boolean}} Extension */

/** @type {Extension[]} */
export const EXTENSIONS = [
  // ---- API extensions ----
  {
    id: 'cors', scope: 'api', name: 'CORS', icon: '🌐', category: 'Networking', recommended: true,
    description: 'Lets browsers, WebGL games and web apps on other domains call your API.',
    fields: [
      { key: 'origins', label: 'Allowed origins (comma separated, * for all)', type: 'text', default: '*' },
      { key: 'credentials', label: 'Allow credentials', type: 'boolean', default: false },
    ],
  },
  {
    id: 'rate-limit', scope: 'api', name: 'Rate Limiter', icon: '🚦', category: 'Protection', recommended: true,
    description: 'Caps how many requests each API key (or IP for public endpoints) can make per minute.',
    fields: [{ key: 'perMinute', label: 'Requests per minute', type: 'number', default: 60, min: 1, max: 10000 }],
  },
  {
    id: 'cache', scope: 'api', name: 'Response Cache', icon: '⚡', category: 'Performance',
    description: 'Caches successful GET responses so repeated calls return instantly without running code.',
    fields: [{ key: 'ttl', label: 'Cache lifetime (seconds)', type: 'number', default: 30, min: 1, max: 86400 }],
  },
  {
    id: 'kv', scope: 'api', name: 'Key-Value Store', icon: '🗄️', category: 'Data', recommended: true,
    description: 'Persistent storage for your endpoints: vix.kv.get / set / delete / list in JavaScript. Survives restarts and is shared by every request.',
    fields: [{ key: 'maxKeys', label: 'Maximum keys', type: 'number', default: 1000, min: 10, max: 10000 }],
  },
  {
    id: 'logger', scope: 'api', name: 'Request Logger', icon: '📜', category: 'Insights', recommended: true,
    description: 'Records every request (method, path, status, timing, console output) in the Logs tab.',
    fields: [{ key: 'captureBodies', label: 'Also store request bodies', type: 'boolean', default: false }],
  },
  {
    id: 'secrets', scope: 'api', name: 'Secrets & Env Vars', icon: '🔐', category: 'Data',
    description: 'Store tokens and settings outside your code. Read them with vix.env.NAME (JavaScript) or as environment variables in Batch.',
    fields: [{ key: 'vars', label: 'Variables (NAME=value, one per line)', type: 'list', default: '' }],
  },
  {
    id: 'ip-allowlist', scope: 'api', name: 'IP Allowlist', icon: '🛡️', category: 'Protection',
    description: 'Only answer requests coming from the IP addresses you list (great for game servers).',
    fields: [{ key: 'ips', label: 'Allowed IPs (comma separated)', type: 'text', default: '' }],
  },
  {
    id: 'maintenance', scope: 'api', name: 'Maintenance Mode', icon: '🚧', category: 'Operations',
    description: 'Temporarily answer every request with 503 and a friendly message while you work.',
    fields: [{ key: 'message', label: 'Message', type: 'text', default: 'Down for maintenance, back soon!' }],
  },
  {
    id: 'pretty-json', scope: 'api', name: 'Pretty JSON', icon: '✨', category: 'Developer',
    description: 'Indents JSON responses so they are easy to read in a browser or terminal.',
  },
  {
    id: 'webhook', scope: 'api', name: 'Webhook Relay', icon: '📨', category: 'Integrations',
    description: 'Sends a copy of every request (method, path, status) to a Discord, Slack or custom webhook URL.',
    fields: [{ key: 'url', label: 'Webhook URL', type: 'text', default: '' }],
  },
  {
    id: 'scheduler', scope: 'api', name: 'Scheduled Jobs', icon: '⏰', category: 'Operations',
    description: 'Calls one of your endpoints automatically on a schedule, even when nobody is online (runs with the platform cron).',
    fields: [{ key: 'route', label: 'Endpoint to call (e.g. GET /tick)', type: 'text', default: 'GET /' }],
  },
  {
    id: 'openapi', scope: 'api', name: 'OpenAPI & AI Tools', icon: '🤖', category: 'Integrations', recommended: true,
    description: 'Publishes openapi.json and an AI tool manifest so ChatGPT Actions, Claude tools, LangChain and MCP clients can discover your endpoints.',
  },

  // ---- Editor extensions ----
  { id: 'vim', scope: 'editor', name: 'Vim Keys', icon: '⌨️', category: 'Keybindings', description: 'Modal editing with Vim keybindings in the code editor.' },
  { id: 'wrap', scope: 'editor', name: 'Word Wrap', icon: '↩️', category: 'Editor', description: 'Wraps long lines instead of scrolling sideways.', recommended: true },
  { id: 'autosave', scope: 'editor', name: 'Auto Save', icon: '💾', category: 'Editor', description: 'Saves files automatically a moment after you stop typing.', recommended: true },
  { id: 'format-on-save', scope: 'editor', name: 'Format on Save', icon: '🧹', category: 'Editor', description: 'Formats JSON and trims trailing whitespace whenever you save.' },
  { id: 'rainbow', scope: 'editor', name: 'Rainbow Brackets', icon: '🌈', category: 'Visual', description: 'Colours matching brackets by depth so nested code is easier to follow.' },
  { id: 'glow', scope: 'editor', name: 'Active Line Glow', icon: '🔦', category: 'Visual', description: 'Highlights the line and gutter you are on with a stronger, high-visibility marker.' },
  { id: 'live-preview', scope: 'editor', name: 'Live HTML Preview', icon: '🖼️', category: 'Sandbox', description: 'Renders HTML and Markdown files live next to the editor.', recommended: true },
  { id: 'speak-output', scope: 'editor', name: 'Read Output Aloud', icon: '🔊', category: 'Accessibility', description: 'Speaks sandbox results using your device\'s text-to-speech voice.' },
  { id: 'snippets', scope: 'editor', name: 'Snippet Pack', icon: '🧩', category: 'Editor', description: 'Adds ready-made snippets for HTTP handlers, JSON responses and game-engine calls to autocomplete.' },
  { id: 'zen', scope: 'editor', name: 'Zen Mode', icon: '🧘', category: 'Visual', description: 'Hides side panels while you type for a distraction-free editor (toggle with Ctrl+Shift+Z).' },
  { id: 'typing-sounds', scope: 'editor', name: 'Typing Sounds', icon: '🎵', category: 'Fun', description: 'Soft mechanical keyboard clicks while you code.' },
  { id: 'confetti', scope: 'editor', name: 'Deploy Confetti', icon: '🎉', category: 'Fun', description: 'Celebrates every successful save and deploy (respects reduced motion).' },
]

export function extensionById(id) {
  return EXTENSIONS.find((e) => e.id === id) || null
}

/** Merges stored settings over the defaults for an extension. */
export function extensionConfig(ext, stored) {
  const out = {}
  for (const f of ext.fields || []) out[f.key] = stored && stored[f.key] !== undefined ? stored[f.key] : f.default
  return out
}

/** Default extensions for a new API. */
export function defaultApiExtensions() {
  return {
    cors: { enabled: true, config: { origins: '*', credentials: false } },
    'rate-limit': { enabled: true, config: { perMinute: 120 } },
    kv: { enabled: true, config: { maxKeys: 1000 } },
    logger: { enabled: true, config: { captureBodies: false } },
    openapi: { enabled: true, config: {} },
  }
}

/** Parses "NAME=value" lines from the secrets extension. */
export function parseSecrets(text) {
  const out = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}
