// Syntax highlighting for code files (highlight.js escapes all text it outputs).
import hljs from 'highlight.js/lib/core';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import lua from 'highlight.js/lib/languages/lua';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import less from 'highlight.js/lib/languages/less';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import dart from 'highlight.js/lib/languages/dart';
import r from 'highlight.js/lib/languages/r';
import perl from 'highlight.js/lib/languages/perl';
import scala from 'highlight.js/lib/languages/scala';
import haskell from 'highlight.js/lib/languages/haskell';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import clojure from 'highlight.js/lib/languages/clojure';
import glsl from 'highlight.js/lib/languages/glsl';
import cmake from 'highlight.js/lib/languages/cmake';

const LANGS = {
  plaintext, python, javascript, typescript, java, kotlin, c, cpp, csharp, rust, go, ruby, php, swift, lua, sql, bash, powershell,
  dos, xml, css, scss, less, yaml, json, ini, markdown, dockerfile, makefile, dart, r, perl, scala, haskell, elixir, erlang, clojure,
  glsl, cmake,
};
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);

export const LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  ['plaintext', 'Plain text'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'],
  ['xml', 'HTML / XML'], ['css', 'CSS'], ['scss', 'SCSS'], ['less', 'Less'], ['markdown', 'Markdown'], ['yaml', 'YAML'], ['ini', 'INI / TOML'],
  ['bash', 'Shell'], ['powershell', 'PowerShell'], ['dos', 'Batch'], ['sql', 'SQL'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['c', 'C'],
  ['cpp', 'C++'], ['csharp', 'C#'], ['rust', 'Rust'], ['go', 'Go'], ['ruby', 'Ruby'], ['php', 'PHP'], ['swift', 'Swift'], ['lua', 'Lua'],
  ['dart', 'Dart'], ['r', 'R'], ['perl', 'Perl'], ['scala', 'Scala'], ['haskell', 'Haskell'], ['elixir', 'Elixir'], ['erlang', 'Erlang'],
  ['clojure', 'Clojure'], ['glsl', 'GLSL'], ['cmake', 'CMake'], ['dockerfile', 'Dockerfile'], ['makefile', 'Makefile'],
].map(([id, label]) => ({ id, label }));

/** Highlighted HTML (all source text is escaped by highlight.js). */
export function highlight(code: string, language: string): string {
  const lang = hljs.getLanguage(language) ? language : 'plaintext';
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
