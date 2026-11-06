// Code-language and code-theme metadata. Kept separate from ./highlight (which
// pulls in highlight.js, ~170 KB) so menus and labels don't load the highlighter.

export const LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  ['plaintext', 'Plain text'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'],
  ['xml', 'HTML / XML'], ['css', 'CSS'], ['scss', 'SCSS'], ['less', 'Less'], ['markdown', 'Markdown'], ['yaml', 'YAML'], ['ini', 'INI / TOML'],
  ['bash', 'Shell'], ['powershell', 'PowerShell'], ['dos', 'Batch'], ['sql', 'SQL'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['c', 'C'],
  ['cpp', 'C++'], ['csharp', 'C#'], ['rust', 'Rust'], ['go', 'Go'], ['ruby', 'Ruby'], ['php', 'PHP'], ['swift', 'Swift'], ['lua', 'Lua'],
  ['dart', 'Dart'], ['r', 'R'], ['perl', 'Perl'], ['scala', 'Scala'], ['haskell', 'Haskell'], ['elixir', 'Elixir'], ['erlang', 'Erlang'],
  ['clojure', 'Clojure'], ['glsl', 'GLSL'], ['cmake', 'CMake'], ['dockerfile', 'Dockerfile'], ['makefile', 'Makefile'],
].map(([id, label]) => ({ id, label }));

/** ``` language hints people actually type, mapped to highlight.js names. */
export const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust',
  sh: 'bash', shell: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', cs: 'csharp', 'c#': 'csharp', 'c++': 'cpp',
  html: 'xml', htm: 'xml', svg: 'xml', yml: 'yaml', toml: 'ini', md: 'markdown', kt: 'kotlin', golang: 'go', bat: 'dos',
  cmd: 'dos', docker: 'dockerfile', make: 'makefile', ex: 'elixir', exs: 'elixir', hs: 'haskell', txt: 'plaintext', text: 'plaintext',
};

export function languageLabel(id: string): string {
  return LANGUAGE_OPTIONS.find((l) => l.id === id)?.label ?? id;
}

export const CODE_THEMES: { id: string; label: string }[] = [
  { id: 'vscode-dark', label: 'Visual Studio Code — Dark+' },
  { id: 'vs-2026', label: 'Visual Studio 2026 — Dark' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'vscode-light', label: 'Visual Studio Code — Light+' },
];
