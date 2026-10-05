// Every language Vix Api understands. Shared by the browser and the serverless
// functions so the editor, the sandbox and the hosted runtime agree.
//
// runner:
//   quickjs - runs in an isolated QuickJS (WebAssembly) VM on the server, fastest
//   remote  - compiled/run by the code execution backend (Piston or Wandbox)
//   batch   - runs in the built-in Windows batch (.bat/.cmd) emulator
//   static  - served as-is with its content type (JSON, HTML, CSV, ...)
//   none    - editable only (docs, config)

const REQ_NOTE = 'The request arrives on stdin as JSON: {method, path, query, headers, body, params}.'

/** @type {Array<{id:string,name:string,ext:string[],runner:string,wandbox?:string[],piston?:string,mime?:string,comment?:string,hello:string,endpoint?:string}>} */
export const LANGUAGES = [
  {
    id: 'javascript', name: 'JavaScript', ext: ['js', 'mjs', 'cjs'], runner: 'quickjs', comment: '//',
    wandbox: ['JavaScript'], piston: 'javascript',
    hello: `// Run me in the sandbox with Ctrl+Enter\nconst langs = ['Rust', 'Python', 'JavaScript', 'Batch']\nfor (const l of langs) console.log('Hello from', l)\n`,
    endpoint: `// Every request to this endpoint calls handler(req, ctx).\n// req: { method, path, query, headers, body, params, ip }\n// Return a string, any JSON value, or { status, headers, body }.\nasync function handler(req, ctx) {\n  const name = req.query.name || 'world'\n  const visits = ((await vix.kv.get('visits')) || 0) + 1\n  await vix.kv.set('visits', visits)\n  return { message: \`Hello, \${name}!\`, visits, time: new Date().toISOString() }\n}\n`,
  },
  {
    id: 'typescript', name: 'TypeScript', ext: ['ts', 'mts', 'cts'], runner: 'remote', comment: '//',
    wandbox: ['TypeScript'], piston: 'typescript',
    hello: `const greet = (who: string): string => \`Hello, \${who}!\`\nconsole.log(greet('Vix'))\n`,
    endpoint: `// ${REQ_NOTE}\nimport * as fs from 'fs'\nconst req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')\nconst body = { message: \`Hello from TypeScript, \${req.query?.name ?? 'world'}!\` }\nconsole.log(JSON.stringify({ status: 200, body }))\n`,
  },
  {
    id: 'python', name: 'Python', ext: ['py', 'pyw'], runner: 'remote', comment: '#',
    wandbox: ['Python'], piston: 'python',
    hello: `def greet(who):\n    return f"Hello, {who}!"\n\nprint(greet("Vix"))\nprint(sum(range(10)))\n`,
    endpoint: `# ${REQ_NOTE}\n# Print JSON {"status", "headers", "body"} or any text.\nimport json, sys\n\nreq = json.loads(sys.stdin.read() or "{}")\nname = req.get("query", {}).get("name", "world")\nprint(json.dumps({"status": 200, "body": {"message": f"Hello from Python, {name}!"}}))\n`,
  },
  {
    id: 'rust', name: 'Rust', ext: ['rs'], runner: 'remote', comment: '//',
    wandbox: ['Rust'], piston: 'rust',
    hello: `fn main() {\n    let langs = ["Rust", "Python", "Batch"];\n    for l in langs.iter() {\n        println!("Hello from {}", l);\n    }\n}\n`,
    endpoint: `// ${REQ_NOTE}\nuse std::io::Read;\n\nfn main() {\n    let mut input = String::new();\n    std::io::stdin().read_to_string(&mut input).unwrap();\n    let size = input.len();\n    println!("{{\\"status\\":200,\\"body\\":{{\\"message\\":\\"Hello from Rust\\",\\"request_bytes\\":{}}}}}", size);\n}\n`,
  },
  {
    id: 'batch', name: 'Batch (.bat)', ext: ['bat', 'cmd'], runner: 'batch', comment: 'REM',
    hello: `@echo off\nset NAME=Vix\necho Hello, %NAME%!\nfor /l %%i in (1,1,3) do echo Count %%i\nif "%NAME%"=="Vix" (\n  echo Batch runs right in the sandbox.\n) else (\n  echo Something went wrong.\n)\n`,
    endpoint: `@echo off\nREM Request info: %VIX_METHOD% %VIX_PATH%, body in %VIX_BODY%\nREM Query params become %QUERY_name% variables.\nif not defined QUERY_name set QUERY_name=world\necho {"message":"Hello from Batch, %QUERY_name%!"}\n`,
  },
  {
    id: 'java', name: 'Java', ext: ['java'], runner: 'remote', comment: '//',
    wandbox: ['Java'], piston: 'java',
    hello: `class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}\n`,
    endpoint: `// ${REQ_NOTE}\nimport java.util.Scanner;\n\nclass Main {\n    public static void main(String[] args) {\n        Scanner s = new Scanner(System.in).useDelimiter("\\\\A");\n        String input = s.hasNext() ? s.next() : "";\n        System.out.println("{\\"status\\":200,\\"body\\":{\\"message\\":\\"Hello from Java\\",\\"bytes\\":" + input.length() + "}}");\n    }\n}\n`,
  },
  {
    id: 'csharp', name: 'C#', ext: ['cs'], runner: 'remote', comment: '//',
    wandbox: ['C#'], piston: 'csharp',
    hello: `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello from C#!");\n    }\n}\n`,
    endpoint: `// ${REQ_NOTE}\nusing System;\n\nclass Program {\n    static void Main() {\n        var input = Console.In.ReadToEnd();\n        Console.WriteLine("{\\"status\\":200,\\"body\\":{\\"message\\":\\"Hello from C#\\",\\"bytes\\":" + input.Length + "}}");\n    }\n}\n`,
  },
  {
    id: 'cpp', name: 'C++', ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'h++'], runner: 'remote', comment: '//',
    wandbox: ['C++'], piston: 'c++',
    hello: `#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++!" << std::endl;\n}\n`,
    endpoint: `// ${REQ_NOTE}\n#include <iostream>\n#include <iterator>\n#include <string>\n\nint main() {\n    std::string in((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());\n    std::cout << "{\\"status\\":200,\\"body\\":{\\"message\\":\\"Hello from C++\\",\\"bytes\\":" << in.size() << "}}";\n}\n`,
  },
  {
    id: 'c', name: 'C', ext: ['c', 'h'], runner: 'remote', comment: '//',
    wandbox: ['C'], piston: 'c',
    hello: `#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C!\\n");\n    return 0;\n}\n`,
    endpoint: `/* ${REQ_NOTE} */\n#include <stdio.h>\n\nint main(void) {\n    long n = 0; while (getchar() != EOF) n++;\n    printf("{\\"status\\":200,\\"body\\":{\\"message\\":\\"Hello from C\\",\\"bytes\\":%ld}}", n);\n    return 0;\n}\n`,
  },
  {
    id: 'go', name: 'Go', ext: ['go'], runner: 'remote', comment: '//',
    wandbox: ['Go'], piston: 'go',
    hello: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from Go!")\n}\n`,
    endpoint: `// ${REQ_NOTE}\npackage main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tvar req map[string]interface{}\n\tjson.NewDecoder(os.Stdin).Decode(&req)\n\tout, _ := json.Marshal(map[string]interface{}{"status": 200, "body": map[string]string{"message": "Hello from Go"}})\n\tfmt.Println(string(out))\n}\n`,
  },
  {
    id: 'lua', name: 'Lua', ext: ['lua', 'luau'], runner: 'remote', comment: '--',
    wandbox: ['Lua'], piston: 'lua',
    hello: `local langs = {"Lua", "Luau", "Roblox"}\nfor i, l in ipairs(langs) do\n  print(i, "Hello from " .. l)\nend\n`,
    endpoint: `-- ${REQ_NOTE}\nlocal input = io.read("*a") or ""\nprint('{"status":200,"body":{"message":"Hello from Lua","bytes":' .. #input .. '}}')\n`,
  },
  {
    id: 'ruby', name: 'Ruby', ext: ['rb'], runner: 'remote', comment: '#',
    wandbox: ['Ruby'], piston: 'ruby',
    hello: `3.times { |i| puts "Hello from Ruby ##{i + 1}" }\n`,
    endpoint: `# ${REQ_NOTE}\nrequire 'json'\nraw = $stdin.read.to_s\nreq = JSON.parse(raw.empty? ? '{}' : raw)\nputs({ status: 200, body: { message: 'Hello from Ruby' } }.to_json)\n`,
  },
  {
    id: 'php', name: 'PHP', ext: ['php'], runner: 'remote', comment: '//',
    wandbox: ['PHP'], piston: 'php',
    hello: `<?php\necho "Hello from PHP!\\n";\n`,
    endpoint: `<?php\n// ${REQ_NOTE}\n$req = json_decode(file_get_contents('php://stdin'), true) ?: [];\n$name = $req['query']['name'] ?? 'world';\necho json_encode(['status' => 200, 'body' => ['message' => "Hello from PHP, $name!"]]);\n`,
  },
  {
    id: 'bash', name: 'Bash / Shell', ext: ['sh', 'bash', 'zsh'], runner: 'remote', comment: '#',
    wandbox: ['Bash script', 'Bash'], piston: 'bash',
    hello: `#!/bin/bash\nfor i in 1 2 3; do\n  echo "Hello from Bash #$i"\ndone\n`,
    endpoint: `#!/bin/bash\n# ${REQ_NOTE}\ninput=$(cat)\necho "{\\"status\\":200,\\"body\\":{\\"message\\":\\"Hello from Bash\\",\\"bytes\\":\${#input}}}"\n`,
  },
  { id: 'kotlin', name: 'Kotlin', ext: ['kt', 'kts'], runner: 'remote', comment: '//', wandbox: ['Kotlin'], piston: 'kotlin', hello: `fun main() {\n    println("Hello from Kotlin!")\n}\n` },
  { id: 'swift', name: 'Swift', ext: ['swift'], runner: 'remote', comment: '//', wandbox: ['Swift'], piston: 'swift', hello: `print("Hello from Swift!")\n` },
  { id: 'dart', name: 'Dart', ext: ['dart'], runner: 'remote', comment: '//', wandbox: ['Dart'], piston: 'dart', hello: `void main() {\n  print('Hello from Dart!');\n}\n` },
  { id: 'perl', name: 'Perl', ext: ['pl', 'pm'], runner: 'remote', comment: '#', wandbox: ['Perl'], piston: 'perl', hello: `print "Hello from Perl!\\n";\n` },
  { id: 'haskell', name: 'Haskell', ext: ['hs'], runner: 'remote', comment: '--', wandbox: ['Haskell'], piston: 'haskell', hello: `main :: IO ()\nmain = putStrLn "Hello from Haskell!"\n` },
  { id: 'scala', name: 'Scala', ext: ['scala', 'sc'], runner: 'remote', comment: '//', wandbox: ['Scala'], piston: 'scala', hello: `object Main extends App {\n  println("Hello from Scala!")\n}\n` },
  { id: 'elixir', name: 'Elixir', ext: ['ex', 'exs'], runner: 'remote', comment: '#', wandbox: ['Elixir'], piston: 'elixir', hello: `IO.puts "Hello from Elixir!"\n` },
  { id: 'erlang', name: 'Erlang', ext: ['erl'], runner: 'remote', comment: '%', wandbox: ['Erlang'], piston: 'erlang', hello: `-module(prog).\n-export([main/0]).\nmain() -> io:format("Hello from Erlang!~n").\n` },
  { id: 'julia', name: 'Julia', ext: ['jl'], runner: 'remote', comment: '#', wandbox: ['Julia'], piston: 'julia', hello: `println("Hello from Julia!")\n` },
  { id: 'r', name: 'R', ext: ['r', 'R'], runner: 'remote', comment: '#', wandbox: ['R'], piston: 'r', hello: `cat("Hello from R!\\n")\nprint(summary(c(1, 2, 3, 4)))\n` },
  { id: 'nim', name: 'Nim', ext: ['nim'], runner: 'remote', comment: '#', wandbox: ['Nim'], piston: 'nim', hello: `echo "Hello from Nim!"\n` },
  { id: 'zig', name: 'Zig', ext: ['zig'], runner: 'remote', comment: '//', wandbox: ['Zig'], piston: 'zig', hello: `const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello from Zig!\\n", .{});\n}\n` },
  { id: 'd', name: 'D', ext: ['d'], runner: 'remote', comment: '//', wandbox: ['D'], piston: 'd', hello: `import std.stdio;\n\nvoid main() {\n    writeln("Hello from D!");\n}\n` },
  { id: 'crystal', name: 'Crystal', ext: ['cr'], runner: 'remote', comment: '#', wandbox: ['Crystal'], piston: 'crystal', hello: `puts "Hello from Crystal!"\n` },
  { id: 'ocaml', name: 'OCaml', ext: ['ml', 'mli'], runner: 'remote', comment: '(*', wandbox: ['OCaml'], piston: 'ocaml', hello: `let () = print_endline "Hello from OCaml!"\n` },
  { id: 'fsharp', name: 'F#', ext: ['fs', 'fsx'], runner: 'remote', comment: '//', wandbox: ['F#'], piston: 'fsharp.net', hello: `printfn "Hello from F#!"\n` },
  { id: 'vb', name: 'Visual Basic', ext: ['vb'], runner: 'remote', comment: "'", wandbox: ['Visual Basic'], piston: 'basic.net', hello: `Module Program\n    Sub Main()\n        Console.WriteLine("Hello from VB!")\n    End Sub\nEnd Module\n` },
  { id: 'pascal', name: 'Pascal', ext: ['pas', 'pp'], runner: 'remote', comment: '//', wandbox: ['Pascal'], piston: 'pascal', hello: `program Hello;\nbegin\n  writeln('Hello from Pascal!');\nend.\n` },
  { id: 'fortran', name: 'Fortran', ext: ['f90', 'f95', 'f03', 'f'], runner: 'remote', comment: '!', wandbox: ['Fortran'], piston: 'fortran', hello: `program hello\n  print *, 'Hello from Fortran!'\nend program hello\n` },
  { id: 'cobol', name: 'COBOL', ext: ['cob', 'cbl'], runner: 'remote', comment: '*>', wandbox: ['COBOL'], piston: 'cobol', hello: `       IDENTIFICATION DIVISION.\n       PROGRAM-ID. HELLO.\n       PROCEDURE DIVISION.\n           DISPLAY 'Hello from COBOL!'.\n           STOP RUN.\n` },
  { id: 'lisp', name: 'Common Lisp', ext: ['lisp', 'lsp', 'cl'], runner: 'remote', comment: ';', wandbox: ['Lisp'], piston: 'lisp', hello: `(format t "Hello from Lisp!~%")\n` },
  { id: 'scheme', name: 'Scheme', ext: ['scm', 'ss'], runner: 'remote', comment: ';', wandbox: ['Scheme'], piston: 'scheme', hello: `(display "Hello from Scheme!")\n(newline)\n` },
  { id: 'clojure', name: 'Clojure', ext: ['clj', 'cljs'], runner: 'remote', comment: ';', wandbox: ['Clojure'], piston: 'clojure', hello: `(println "Hello from Clojure!")\n` },
  { id: 'groovy', name: 'Groovy', ext: ['groovy', 'gvy'], runner: 'remote', comment: '//', wandbox: ['Groovy'], piston: 'groovy', hello: `println "Hello from Groovy!"\n` },
  { id: 'powershell', name: 'PowerShell', ext: ['ps1', 'psm1'], runner: 'remote', comment: '#', piston: 'powershell', hello: `Write-Output "Hello from PowerShell!"\n1..3 | ForEach-Object { "Count $_" }\n` },
  { id: 'sql', name: 'SQL (SQLite)', ext: ['sql'], runner: 'remote', comment: '--', wandbox: ['SQL'], piston: 'sqlite3', hello: `CREATE TABLE langs(name TEXT);\nINSERT INTO langs VALUES ('Rust'), ('Python'), ('SQL');\nSELECT 'Hello from ' || name FROM langs;\n` },
  { id: 'brainfuck', name: 'Brainfuck', ext: ['bf', 'b'], runner: 'remote', comment: '', piston: 'brainfuck', hello: `++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.\n` },
  { id: 'assembly', name: 'Assembly (NASM)', ext: ['asm', 's'], runner: 'remote', comment: ';', piston: 'nasm64', hello: `section .data\n    msg db "Hello from Assembly!", 10\nsection .text\n    global _start\n_start:\n    mov rax, 1\n    mov rdi, 1\n    mov rsi, msg\n    mov rdx, 21\n    syscall\n    mov rax, 60\n    xor rdi, rdi\n    syscall\n` },
  { id: 'gdscript', name: 'GDScript', ext: ['gd'], runner: 'none', comment: '#', hello: `extends Node\n\nfunc _ready():\n\tprint("Hello from Godot!")\n` },
  { id: 'json', name: 'JSON', ext: ['json', 'jsonc'], runner: 'static', mime: 'application/json', hello: `{\n  "name": "Vix Api",\n  "ok": true\n}\n` },
  { id: 'html', name: 'HTML', ext: ['html', 'htm'], runner: 'static', mime: 'text/html; charset=utf-8', hello: `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Hello</title></head>\n<body><h1>Hello from Vix Api</h1></body>\n</html>\n` },
  { id: 'css', name: 'CSS', ext: ['css', 'scss', 'sass', 'less'], runner: 'static', mime: 'text/css; charset=utf-8', hello: `body {\n  font-family: system-ui;\n}\n` },
  { id: 'xml', name: 'XML', ext: ['xml', 'svg', 'plist'], runner: 'static', mime: 'application/xml', hello: `<?xml version="1.0"?>\n<hello from="Vix Api"/>\n` },
  { id: 'yaml', name: 'YAML', ext: ['yaml', 'yml'], runner: 'static', mime: 'application/yaml', hello: `name: Vix Api\nok: true\n` },
  { id: 'toml', name: 'TOML', ext: ['toml'], runner: 'static', mime: 'application/toml', hello: `[package]\nname = "vix"\n` },
  { id: 'csv', name: 'CSV', ext: ['csv', 'tsv'], runner: 'static', mime: 'text/csv; charset=utf-8', hello: `id,name\n1,Vix\n` },
  { id: 'markdown', name: 'Markdown', ext: ['md', 'markdown'], runner: 'static', mime: 'text/markdown; charset=utf-8', hello: `# Hello\n\nWritten in **Markdown**.\n` },
  { id: 'text', name: 'Plain text', ext: ['txt', 'log', 'env', 'ini', 'cfg', 'conf'], runner: 'static', mime: 'text/plain; charset=utf-8', hello: `Hello from Vix Api\n` },
  { id: 'dockerfile', name: 'Dockerfile', ext: ['dockerfile'], runner: 'none', comment: '#', hello: `FROM node:22-alpine\nCMD ["node", "-e", "console.log('hi')"]\n` },
]

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]))
const BY_EXT = new Map()
for (const l of LANGUAGES) for (const e of l.ext) BY_EXT.set(e.toLowerCase(), l)

export function languageById(id) {
  return BY_ID.get(id) || null
}

/** Picks a language from a file path, e.g. "src/main.rs" -> Rust. */
export function languageForPath(path) {
  const name = String(path || '').split('/').pop() || ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return BY_ID.get('dockerfile')
  if (lower === 'makefile') return BY_ID.get('text')
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return BY_ID.get('text')
  return BY_EXT.get(lower.slice(dot + 1)) || BY_ID.get('text')
}

export function isRunnable(lang) {
  return !!lang && (lang.runner === 'quickjs' || lang.runner === 'remote' || lang.runner === 'batch')
}

/** Default file name used when a new file is created for a language. */
export function defaultFileName(lang) {
  if (lang.id === 'java') return 'Main.java'
  if (lang.id === 'dockerfile') return 'Dockerfile'
  return `main.${lang.ext[0]}`
}
