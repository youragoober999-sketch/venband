// Step-by-step guides for connecting a Vix API to AI agents, game engines and
// programming languages. Every snippet is generated with the reader's real URL.

export type GuideCtx = { base: string; route: string; method: string; key: string; apiName: string }
export type GuideStep = { title: string; text?: string; code?: string; lang?: string }
export type Guide = { id: string; name: string; category: 'AI & agents' | 'Game engines' | 'Languages' | 'Tools & no-code'; icon: string; summary: string; steps: (c: GuideCtx) => GuideStep[] }

const url = (c: GuideCtx) => `${c.base}${c.route === '/' ? '' : c.route}`
const isGet = (c: GuideCtx) => c.method === 'GET' || c.method === 'ANY'
const sampleBody = '{"player": "ana", "score": 1200}'

const KEY_STEP = (c: GuideCtx): GuideStep => ({
  title: 'Create an API key',
  text: `Open **API Keys** in the sidebar, click **Create key**, and copy it. Keep it secret - anyone with the key can call ${c.apiName}. Send it in the \`x-api-key\` header (or \`Authorization: Bearer <key>\`). Endpoints marked **Public** do not need a key.`,
})

export const GUIDES: Guide[] = [
  // ------------------------------------------------------------- AI ----
  {
    id: 'chatgpt', name: 'ChatGPT (Custom GPT Actions)', category: 'AI & agents', icon: '🤖',
    summary: 'Let a Custom GPT call your API using the auto-generated OpenAPI spec.',
    steps: (c) => [
      { title: 'Turn on the "OpenAPI & AI Tools" extension', text: 'It is on by default for new APIs. Your spec lives at:', code: `${c.base}/openapi.json`, lang: 'text' },
      KEY_STEP(c),
      { title: 'Create the GPT', text: 'In ChatGPT open **Explore GPTs → Create → Configure → Create new action**. Choose **Import from URL** and paste the openapi.json URL above.' },
      { title: 'Add authentication', text: 'Click **Authentication → API Key → Custom**, header name `x-api-key`, and paste your key.' },
      { title: 'Describe when to use it', text: 'In the GPT instructions, tell it what your endpoints are for, e.g. "Use the leaderboard action whenever the user asks about high scores." Test in the preview pane.' },
    ],
  },
  {
    id: 'claude', name: 'Claude (tool use & MCP)', category: 'AI & agents', icon: '✳️',
    summary: 'Give Claude your API as tools - through MCP in Claude Code/Desktop, or tool use in the Claude API.',
    steps: (c) => [
      { title: 'Your built-in MCP server', text: 'Every Vix API with the "OpenAPI & AI Tools" extension is also a Model Context Protocol server. Each endpoint becomes a tool:', code: `${c.base}/mcp`, lang: 'text' },
      KEY_STEP(c),
      { title: 'Claude Code', text: 'Add it as a remote HTTP MCP server, sending your key as a header:', code: `claude mcp add --transport http vix-${c.apiName.toLowerCase().replace(/[^a-z0-9]+/g, '-')} ${c.base}/mcp --header "x-api-key: ${c.key}"`, lang: 'bash' },
      {
        title: 'Claude API - MCP connector (Python)',
        text: 'Point the Messages API at the same MCP URL. Install with `pip install anthropic` and set `ANTHROPIC_API_KEY`.',
        lang: 'python',
        code: `import anthropic

client = anthropic.Anthropic()

response = client.beta.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    betas=["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
    fallbacks="default",
    mcp_servers=[{
        "type": "url",
        "url": "${c.base}/mcp",
        "name": "vix",
        "authorization_token": "${c.key}",  # sent as Authorization: Bearer
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "vix"}],
    messages=[{"role": "user", "content": "Use my Vix API to answer: what are the top scores?"}],
)

if response.stop_reason == "refusal":
    print("Declined:", response.stop_details)
else:
    for block in response.content:
        if block.type == "text":
            print(block.text)`,
      },
      {
        title: 'Claude API - your own tool loop (Python)',
        text: 'Prefer full control? Describe the endpoint as a tool and call it yourself when Claude asks.',
        lang: 'python',
        code: `import json, requests, anthropic

client = anthropic.Anthropic()
VIX_URL = "${url(c)}"
VIX_KEY = "${c.key}"

tools = [{
    "name": "call_vix_api",
    "description": "Calls ${c.apiName} (${c.method} ${c.route}). Use it when the user needs data from it.",
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "object", "description": "Query string parameters", "additionalProperties": {"type": "string"}}},
        "required": [],
    },
}]

messages = [{"role": "user", "content": "What does my Vix API return right now?"}]
while True:
    response = client.beta.messages.create(
        model="claude-opus-5-5", max_tokens=16000, tools=tools, messages=messages,
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    )
    if response.stop_reason != "tool_use":
        break
    messages.append({"role": "assistant", "content": response.content})
    results = []
    for block in response.content:
        if block.type == "tool_use":
            r = requests.request("${isGet(c) ? 'GET' : c.method}", VIX_URL, params=block.input.get("query"), headers={"x-api-key": VIX_KEY}, timeout=30)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": r.text, "is_error": not r.ok})
    messages.append({"role": "user", "content": results})

print(next((b.text for b in response.content if b.type == "text"), response.stop_reason))`,
      },
      { title: 'Claude Desktop & other MCP apps', text: 'Any MCP client that supports remote (Streamable HTTP) servers can use the same URL plus the `x-api-key` header - Cursor, Windsurf, VS Code Copilot agent mode and more.' },
    ],
  },
  {
    id: 'openai', name: 'OpenAI function calling', category: 'AI & agents', icon: '🧠',
    summary: 'Expose your endpoint as a function for GPT models with the OpenAI SDK.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Python', lang: 'python',
        code: `import json, requests
from openai import OpenAI

client = OpenAI()
tools = [{
    "type": "function",
    "name": "call_vix_api",
    "description": "Calls ${c.apiName} (${c.method} ${c.route})",
    "parameters": {"type": "object", "properties": {"query": {"type": "object", "additionalProperties": {"type": "string"}}}},
}]

resp = client.responses.create(model="gpt-5", input="What does my API say?", tools=tools)
for item in resp.output:
    if item.type == "function_call":
        args = json.loads(item.arguments or "{}")
        data = requests.get("${url(c)}", params=args.get("query"), headers={"x-api-key": "${c.key}"}).text
        print(data)`,
      },
    ],
  },
  {
    id: 'langchain', name: 'LangChain & LlamaIndex', category: 'AI & agents', icon: '🦜',
    summary: 'Wrap your API as an agent tool in Python.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'LangChain tool', lang: 'python',
        code: `import requests
from langchain_core.tools import tool

@tool
def vix_api(query: str = "") -> str:
    """Calls ${c.apiName} at ${c.route}. Pass query parameters like 'name=ana'."""
    params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
    r = requests.${isGet(c) ? 'get' : 'post'}("${url(c)}", params=params, headers={"x-api-key": "${c.key}"}, timeout=30)
    return r.text

# Pass [vix_api] to any agent, e.g. create_react_agent(model, tools=[vix_api])`,
      },
      { title: 'OpenAPI loaders', text: 'Tools that load OpenAPI specs (LangChain OpenAPIToolkit, LlamaIndex OpenAPIToolSpec, Semantic Kernel, Dify, Flowise) can import:', code: `${c.base}/openapi.json`, lang: 'text' },
    ],
  },
  {
    id: 'discord', name: 'Discord & Telegram bots', category: 'AI & agents', icon: '💬',
    summary: 'Call your API from a bot command, or post every request into a channel.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'discord.js slash command', lang: 'javascript',
        code: `client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'vix') return
  const res = await fetch('${url(c)}', { headers: { 'x-api-key': process.env.VIX_KEY } })
  const data = await res.json()
  await i.reply('\`\`\`json\\n' + JSON.stringify(data, null, 2).slice(0, 1900) + '\\n\`\`\`')
})`,
      },
      { title: 'Webhook Relay extension', text: 'Enable **Webhook Relay** in the Extensions tab and paste a Discord or Slack webhook URL to get a message for every request.' },
    ],
  },

  // ------------------------------------------------------ Game engines ----
  {
    id: 'unity', name: 'Unity (C#)', category: 'Game engines', icon: '🎮',
    summary: 'Call your API with UnityWebRequest from any MonoBehaviour. Works on PC, mobile, consoles and WebGL.',
    steps: (c) => [
      KEY_STEP(c),
      { title: 'Create a script', text: 'In the Project window: **Create → C# Script**, name it `VixApi`, and paste:' },
      {
        title: 'VixApi.cs', lang: 'csharp',
        code: `using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class VixApi : MonoBehaviour
{
    // Tip: don't ship secret keys in public builds - mark read-only endpoints as Public instead.
    const string BaseUrl = "${c.base}";
    const string ApiKey = "${c.key}";

    void Start() => StartCoroutine(Get("${c.route}"));

    public IEnumerator Get(string route)
    {
        using var req = UnityWebRequest.Get(BaseUrl + route);
        req.SetRequestHeader("x-api-key", ApiKey);
        yield return req.SendWebRequest();
        if (req.result != UnityWebRequest.Result.Success) Debug.LogError(req.error + " " + req.downloadHandler.text);
        else Debug.Log(req.downloadHandler.text);
    }

    public IEnumerator Post(string route, string json)
    {
        using var req = new UnityWebRequest(BaseUrl + route, "POST");
        req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        req.SetRequestHeader("x-api-key", ApiKey);
        yield return req.SendWebRequest();
        Debug.Log(req.downloadHandler.text);
    }
}`,
      },
      { title: 'Parse JSON', text: 'Use `JsonUtility.FromJson<MyType>(text)` for simple objects, or Newtonsoft JSON (`com.unity.nuget.newtonsoft-json`) for dictionaries and arrays.' },
      { title: 'WebGL builds', text: 'Keep the **CORS** extension enabled so browser builds can reach your API.' },
    ],
  },
  {
    id: 'unreal', name: 'Unreal Engine (C++ & Blueprints)', category: 'Game engines', icon: '🧱',
    summary: 'Use the HTTP module from C++, or VaRest / HTTP Blueprint nodes.',
    steps: (c) => [
      KEY_STEP(c),
      { title: 'Enable the HTTP module', text: 'Add `"HTTP", "Json", "JsonUtilities"` to `PublicDependencyModuleNames` in your `.Build.cs` file.' },
      {
        title: 'C++', lang: 'cpp',
        code: `#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"

void UVixApi::CallApi()
{
    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
    Req->SetURL(TEXT("${url(c)}"));
    Req->SetVerb(TEXT("${isGet(c) ? 'GET' : c.method}"));
    Req->SetHeader(TEXT("x-api-key"), TEXT("${c.key}"));
    Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Req->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Res, bool bOk)
    {
        if (bOk && Res.IsValid())
            UE_LOG(LogTemp, Log, TEXT("Vix: %d %s"), Res->GetResponseCode(), *Res->GetContentAsString());
    });
    Req->ProcessRequest();
}`,
      },
      { title: 'Blueprints', text: 'Install the free **VaRest** plugin (or use UE 5.4+ "HTTP" nodes). Create a VaRest request, set URL to your endpoint, add header `x-api-key`, then bind **On Request Complete** and read the JSON object.' },
    ],
  },
  {
    id: 'godot', name: 'Godot (GDScript & C#)', category: 'Game engines', icon: '🤖',
    summary: 'Use the HTTPRequest node. Works in Godot 4 and 3.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'GDScript (Godot 4)', lang: 'gdscript',
        code: `extends Node

const BASE := "${c.base}"
const KEY := "${c.key}"

func _ready() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(_on_done)
	var headers := ["x-api-key: " + KEY, "Content-Type: application/json"]
	http.request(BASE + "${c.route}", headers, HTTPClient.METHOD_${isGet(c) ? 'GET' : c.method})

func _on_done(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	var data = JSON.parse_string(body.get_string_from_utf8())
	print(code, " ", data)`,
      },
      { title: 'Sending JSON', text: 'For POST pass a body string as the 4th argument: `http.request(url, headers, HTTPClient.METHOD_POST, JSON.stringify({"score": 10}))`.' },
      { title: 'Web exports', text: 'Keep the **CORS** extension enabled for HTML5 exports.' },
    ],
  },
  {
    id: 'roblox', name: 'Roblox (Luau)', category: 'Game engines', icon: '🟥',
    summary: 'Call your API from a server Script with HttpService.',
    steps: (c) => [
      { title: 'Allow HTTP requests', text: 'In Roblox Studio: **Game Settings → Security → Allow HTTP Requests**.' },
      KEY_STEP(c),
      { title: 'Store the key as a Secret', text: 'Roblox supports secrets: **Game Settings → Security → Secrets**. Add one named `VIX_KEY`. Only server Scripts can read it - never put keys in LocalScripts.' },
      {
        title: 'ServerScriptService/VixApi', lang: 'lua',
        code: `local HttpService = game:GetService("HttpService")
local key = HttpService:GetSecret("VIX_KEY")

local ok, res = pcall(function()
	return HttpService:RequestAsync({
		Url = "${url(c)}",
		Method = "${isGet(c) ? 'GET' : c.method}",
		Headers = { ["x-api-key"] = key, ["Content-Type"] = "application/json" },${isGet(c) ? '' : `\n\t\tBody = HttpService:JSONEncode({ player = "ana", score = 1200 }),`}
	})
end)

if ok and res.Success then
	local data = HttpService:JSONDecode(res.Body)
	print("Vix:", data)
else
	warn("Vix request failed", ok and res.StatusCode or res)
end`,
      },
    ],
  },
  {
    id: 'gamemaker', name: 'GameMaker (GML)', category: 'Game engines', icon: '🕹️',
    summary: 'Use http_request and the Async HTTP event.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Create event', lang: 'gml',
        code: `var headers = ds_map_create();
ds_map_add(headers, "x-api-key", "${c.key}");
ds_map_add(headers, "Content-Type", "application/json");
request_id = http_request("${url(c)}", "${isGet(c) ? 'GET' : c.method}", headers, ${isGet(c) ? '""' : `json_stringify({ player: "ana", score: 1200 })`});
ds_map_destroy(headers);`,
      },
      {
        title: 'Async - HTTP event', lang: 'gml',
        code: `if (async_load[? "id"] == request_id && async_load[? "status"] == 0) {
    var data = json_parse(async_load[? "result"]);
    show_debug_message(data);
}`,
      },
    ],
  },
  {
    id: 'phaser', name: 'Phaser, PixiJS, Three.js & web games', category: 'Game engines', icon: '🌐',
    summary: 'Any browser game can use fetch. Keep CORS enabled.',
    steps: (c) => [
      KEY_STEP(c),
      { title: 'Browser warning', text: 'Code running in a browser is public. Mark read-only endpoints **Public** (no key) or proxy write calls through your own server.' },
      {
        title: 'JavaScript', lang: 'javascript',
        code: `const res = await fetch('${url(c)}', {
  method: '${isGet(c) ? 'GET' : c.method}',
  headers: { 'content-type': 'application/json', 'x-api-key': '${c.key}' },${isGet(c) ? '' : `\n  body: JSON.stringify(${sampleBody}),`}
})
const data = await res.json()
console.log(data)`,
      },
    ],
  },
  {
    id: 'bevy', name: 'Bevy & Macroquad (Rust)', category: 'Game engines', icon: '🦀',
    summary: 'Use reqwest (native) or ehttp (native + WASM).',
    steps: (c) => [
      KEY_STEP(c),
      { title: 'Cargo.toml', lang: 'toml', code: `[dependencies]\nehttp = "0.5"\nserde_json = "1"` },
      {
        title: 'Request', lang: 'rust',
        code: `let mut req = ehttp::Request::get("${url(c)}");
req.headers.insert("x-api-key", "${c.key}");
ehttp::fetch(req, move |result| {
    match result {
        Ok(res) => println!("{} {}", res.status, res.text().unwrap_or_default()),
        Err(e) => eprintln!("Vix request failed: {e}"),
    }
});`,
      },
    ],
  },
  {
    id: 'love', name: 'LÖVE, Defold & Solar2D (Lua)', category: 'Game engines', icon: '💗',
    summary: 'Lua engines with built-in or bundled HTTP clients.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Defold', lang: 'lua',
        code: `http.request("${url(c)}", "${isGet(c) ? 'GET' : c.method}", function(self, id, res)
    print(res.status, res.response)
    local data = json.decode(res.response)
end, { ["x-api-key"] = "${c.key}", ["Content-Type"] = "application/json" })`,
      },
      {
        title: 'LÖVE 11.5+ (lua-https)', lang: 'lua',
        code: `local https = require("https")
local code, body = https.request("${url(c)}", {
    method = "${isGet(c) ? 'GET' : c.method}",
    headers = { ["x-api-key"] = "${c.key}" },
})
print(code, body)`,
      },
      {
        title: 'Solar2D (Corona)', lang: 'lua',
        code: `network.request("${url(c)}", "${isGet(c) ? 'GET' : c.method}", function(e)
    if not e.isError then print(e.response) end
end, { headers = { ["x-api-key"] = "${c.key}" } })`,
      },
    ],
  },
  {
    id: 'cocos', name: 'Cocos Creator & Construct 3', category: 'Game engines', icon: '🥥',
    summary: 'TypeScript in Cocos, the AJAX plugin in Construct.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Cocos Creator (TypeScript)', lang: 'typescript',
        code: `const res = await fetch('${url(c)}', { headers: { 'x-api-key': '${c.key}' } })
const data = await res.json()
console.log(data)`,
      },
      { title: 'Construct 3', text: 'Add the **AJAX** object. Use **Set request header** (`x-api-key` = your key), then **Request URL** with your endpoint, and read `AJAX.LastData` in **On completed**. Parse it with the JSON object.' },
    ],
  },
  {
    id: 'rpgmaker', name: 'RPG Maker MZ / MV', category: 'Game engines', icon: '🗡️',
    summary: 'Call your API from a plugin or a Script event command.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Script command', lang: 'javascript',
        code: `fetch('${url(c)}', { headers: { 'x-api-key': '${c.key}' } })
  .then((r) => r.json())
  .then((data) => {
    $gameVariables.setValue(1, JSON.stringify(data))
    $gameMessage.add('Server says: ' + (data.message || 'ok'))
  })`,
      },
    ],
  },
  {
    id: 'minecraft', name: 'Minecraft (Spigot/Paper & Fabric)', category: 'Game engines', icon: '⛏️',
    summary: 'Use Java\'s built-in HttpClient from a plugin or mod.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Java 17+', lang: 'java',
        code: `HttpClient http = HttpClient.newHttpClient();
HttpRequest req = HttpRequest.newBuilder(URI.create("${url(c)}"))
    .header("x-api-key", "${c.key}")
    .${isGet(c) ? 'GET()' : `method("${c.method}", HttpRequest.BodyPublishers.ofString("${sampleBody.replace(/"/g, '\\"')}"))`}
    .build();
http.sendAsync(req, HttpResponse.BodyHandlers.ofString())
    .thenAccept(res -> getLogger().info("Vix: " + res.body()));`,
      },
      { title: 'Main thread', text: 'Never block the server thread - use `sendAsync` and switch back with the scheduler (`Bukkit.getScheduler().runTask(...)`) before touching the world.' },
    ],
  },
  {
    id: 'stride', name: 'MonoGame, Stride, FNA & Godot C#', category: 'Game engines', icon: '🟦',
    summary: 'Use .NET HttpClient.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'C#', lang: 'csharp',
        code: `using var http = new HttpClient();
http.DefaultRequestHeaders.Add("x-api-key", "${c.key}");
var json = await http.GetStringAsync("${url(c)}");
Console.WriteLine(json);`,
      },
    ],
  },
  {
    id: 'pygame', name: 'Pygame, Ren\'Py & Arcade (Python)', category: 'Game engines', icon: '🐍',
    summary: 'Use requests (or urllib) - run it on a thread so the game loop stays smooth.',
    steps: (c) => [
      KEY_STEP(c),
      {
        title: 'Python', lang: 'python',
        code: `import threading, requests

def call_vix(on_done):
    def work():
        r = requests.get("${url(c)}", headers={"x-api-key": "${c.key}"}, timeout=10)
        on_done(r.json())
    threading.Thread(target=work, daemon=True).start()

call_vix(lambda data: print("Vix:", data))`,
      },
    ],
  },

  // --------------------------------------------------------- Languages ----
  {
    id: 'curl', name: 'cURL / terminal', category: 'Languages', icon: '⌨️', summary: 'Quick tests from any terminal.',
    steps: (c) => [
      KEY_STEP(c),
      { title: 'macOS / Linux / Git Bash', lang: 'bash', code: `curl ${isGet(c) ? '' : `-X ${c.method} -H "content-type: application/json" -d '${sampleBody}' `}-H "x-api-key: ${c.key}" "${url(c)}"` },
      { title: 'Windows PowerShell', lang: 'powershell', code: `Invoke-RestMethod -Uri "${url(c)}" -Method ${isGet(c) ? 'Get' : c.method.charAt(0) + c.method.slice(1).toLowerCase()} -Headers @{ "x-api-key" = "${c.key}" }${isGet(c) ? '' : ` -ContentType "application/json" -Body '${sampleBody}'`}` },
      { title: 'Windows .bat', lang: 'batch', code: `@echo off\ncurl -s -H "x-api-key: ${c.key}" "${url(c)}"\npause` },
    ],
  },
  {
    id: 'javascript', name: 'JavaScript / Node.js / Deno / Bun', category: 'Languages', icon: '🟨', summary: 'fetch works everywhere.',
    steps: (c) => [KEY_STEP(c), { title: 'fetch', lang: 'javascript', code: `const res = await fetch('${url(c)}', {\n  method: '${isGet(c) ? 'GET' : c.method}',\n  headers: { 'x-api-key': process.env.VIX_KEY, 'content-type': 'application/json' },${isGet(c) ? '' : `\n  body: JSON.stringify(${sampleBody}),`}\n})\nif (!res.ok) throw new Error(await res.text())\nconsole.log(await res.json())` }],
  },
  {
    id: 'python', name: 'Python', category: 'Languages', icon: '🐍', summary: 'requests or httpx.',
    steps: (c) => [KEY_STEP(c), { title: 'requests', lang: 'python', code: `import os, requests\n\nr = requests.${isGet(c) ? 'get' : c.method.toLowerCase()}(\n    "${url(c)}",\n    headers={"x-api-key": os.environ["VIX_KEY"]},${isGet(c) ? '' : `\n    json=${sampleBody.replace(/"/g, '"')},`}\n    timeout=30,\n)\nr.raise_for_status()\nprint(r.json())` }],
  },
  {
    id: 'rust', name: 'Rust', category: 'Languages', icon: '🦀', summary: 'reqwest (blocking or async).',
    steps: (c) => [KEY_STEP(c), { title: 'Cargo.toml', lang: 'toml', code: `[dependencies]\nreqwest = { version = "0.12", features = ["blocking", "json"] }\nserde_json = "1"` }, { title: 'main.rs', lang: 'rust', code: `fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let body: serde_json::Value = reqwest::blocking::Client::new()\n        .${isGet(c) ? 'get' : c.method.toLowerCase()}("${url(c)}")\n        .header("x-api-key", std::env::var("VIX_KEY")?)\n        .send()?\n        .json()?;\n    println!("{body:#}");\n    Ok(())\n}` }],
  },
  {
    id: 'csharp', name: 'C# / .NET', category: 'Languages', icon: '🟪', summary: 'HttpClient.',
    steps: (c) => [KEY_STEP(c), { title: 'C#', lang: 'csharp', code: `using var http = new HttpClient();\nhttp.DefaultRequestHeaders.Add("x-api-key", Environment.GetEnvironmentVariable("VIX_KEY"));\nvar res = await http.GetAsync("${url(c)}");\nConsole.WriteLine(await res.Content.ReadAsStringAsync());` }],
  },
  {
    id: 'java', name: 'Java & Kotlin', category: 'Languages', icon: '☕', summary: 'java.net.http.HttpClient.',
    steps: (c) => [KEY_STEP(c), { title: 'Java', lang: 'java', code: `var http = java.net.http.HttpClient.newHttpClient();\nvar req = java.net.http.HttpRequest.newBuilder(java.net.URI.create("${url(c)}"))\n    .header("x-api-key", System.getenv("VIX_KEY")).build();\nvar res = http.send(req, java.net.http.HttpResponse.BodyHandlers.ofString());\nSystem.out.println(res.body());` }, { title: 'Kotlin (Android: OkHttp)', lang: 'kotlin', code: `val client = OkHttpClient()\nval req = Request.Builder().url("${url(c)}").header("x-api-key", BuildConfig.VIX_KEY).build()\nclient.newCall(req).execute().use { println(it.body?.string()) }` }],
  },
  {
    id: 'go', name: 'Go', category: 'Languages', icon: '🐹', summary: 'net/http.',
    steps: (c) => [KEY_STEP(c), { title: 'Go', lang: 'go', code: `req, _ := http.NewRequest("${isGet(c) ? 'GET' : c.method}", "${url(c)}", nil)\nreq.Header.Set("x-api-key", os.Getenv("VIX_KEY"))\nres, err := http.DefaultClient.Do(req)\nif err != nil { log.Fatal(err) }\ndefer res.Body.Close()\nbody, _ := io.ReadAll(res.Body)\nfmt.Println(string(body))` }],
  },
  {
    id: 'php', name: 'PHP', category: 'Languages', icon: '🐘', summary: 'cURL extension.',
    steps: (c) => [KEY_STEP(c), { title: 'PHP', lang: 'php', code: `<?php\n$ch = curl_init("${url(c)}");\ncurl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ["x-api-key: " . getenv("VIX_KEY")]]);\n$data = json_decode(curl_exec($ch), true);\nprint_r($data);` }],
  },
  {
    id: 'swift', name: 'Swift (iOS/macOS)', category: 'Languages', icon: '🍎', summary: 'URLSession async/await.',
    steps: (c) => [KEY_STEP(c), { title: 'Swift', lang: 'swift', code: `var req = URLRequest(url: URL(string: "${url(c)}")!)\nreq.setValue(vixKey, forHTTPHeaderField: "x-api-key")\nlet (data, _) = try await URLSession.shared.data(for: req)\nprint(String(decoding: data, as: UTF8.self))` }],
  },
  {
    id: 'dart', name: 'Dart & Flutter', category: 'Languages', icon: '🎯', summary: 'package:http.',
    steps: (c) => [KEY_STEP(c), { title: 'Dart', lang: 'dart', code: `import 'package:http/http.dart' as http;\nimport 'dart:convert';\n\nfinal res = await http.get(Uri.parse('${url(c)}'), headers: {'x-api-key': vixKey});\nfinal data = jsonDecode(res.body);\nprint(data);` }],
  },
  {
    id: 'ruby', name: 'Ruby', category: 'Languages', icon: '💎', summary: 'net/http.',
    steps: (c) => [KEY_STEP(c), { title: 'Ruby', lang: 'ruby', code: `require "net/http"\nrequire "json"\n\nuri = URI("${url(c)}")\nreq = Net::HTTP::Get.new(uri, "x-api-key" => ENV["VIX_KEY"])\nres = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |h| h.request(req) }\nputs JSON.parse(res.body)` }],
  },

  // ---------------------------------------------------------- No-code ----
  {
    id: 'zapier', name: 'Zapier, Make & n8n', category: 'Tools & no-code', icon: '⚙️', summary: 'Use a generic HTTP / Webhook step.',
    steps: (c) => [KEY_STEP(c), { title: 'Add an HTTP step', text: `Choose **Webhooks by Zapier → Custom Request**, **Make → HTTP → Make a request**, or **n8n → HTTP Request**. Method \`${isGet(c) ? 'GET' : c.method}\`, URL below, and a header \`x-api-key\` with your key.`, code: url(c), lang: 'text' }],
  },
  {
    id: 'postman', name: 'Postman, Insomnia & Bruno', category: 'Tools & no-code', icon: '📮', summary: 'Import the OpenAPI spec to get every endpoint at once.',
    steps: (c) => [KEY_STEP(c), { title: 'Import', text: '**Import → Link** and paste the spec URL. Then set an `x-api-key` header (or API Key auth) on the collection.', code: `${c.base}/openapi.json`, lang: 'text' }],
  },
  {
    id: 'sheets', name: 'Google Sheets & Excel', category: 'Tools & no-code', icon: '📊', summary: 'Pull API data into a spreadsheet.',
    steps: (c) => [
      { title: 'Google Sheets (Apps Script)', text: '**Extensions → Apps Script**, paste this, then use `=VIX("/route")` in a cell.', lang: 'javascript', code: `function VIX(route) {\n  const res = UrlFetchApp.fetch('${c.base}' + route, { headers: { 'x-api-key': PropertiesService.getScriptProperties().getProperty('VIX_KEY') } })\n  return res.getContentText()\n}` },
      { title: 'Excel', text: '**Data → From Web → Advanced**, URL parts: your endpoint; HTTP request header: `x-api-key` with your key.' },
    ],
  },
]

export const GUIDE_CATEGORIES = ['AI & agents', 'Game engines', 'Languages', 'Tools & no-code'] as const
