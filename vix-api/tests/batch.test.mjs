import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBatch } from '../shared/batch.js'

const run = (src, opts) => runBatch(src, opts)

test('echo, variables and substrings', () => {
  const r = run('@echo off\nset NAME=Vix Api\necho Hello, %NAME%!\necho %NAME:~0,3%\necho %NAME:Api=Rocks%\necho.\necho done')
  assert.equal(r.stdout, 'Hello, Vix Api!\nVix\nVix Rocks\n\ndone\n')
  assert.equal(r.exitCode, 0)
})

test('if / else blocks and comparisons', () => {
  const r = run('@echo off\nset A=5\nif %A% GTR 3 (\n  echo big\n) else (\n  echo small\n)\nif not "%A%"=="5" echo wrong\nif defined A echo defined\nif /i "abc"=="ABC" echo ci')
  assert.equal(r.stdout, 'big\ndefined\nci\n')
})

test('for loops', () => {
  const r = run('@echo off\nfor /l %%i in (1,1,3) do echo n%%i\nfor %%x in (a b "c d") do echo [%%~x]\nfor /f "tokens=1,2 delims=," %%a in ("x,y") do echo %%b-%%a')
  assert.equal(r.stdout, 'n1\nn2\nn3\n[a]\n[b]\n[c d]\ny-x\n')
})

test('set /a arithmetic and delayed expansion', () => {
  const r = run('@echo off\nsetlocal enabledelayedexpansion\nset /a total=0\nfor /l %%i in (1,1,4) do set /a total+=%%i\necho !total!\nset /a x=(2+3)*4 %% 7\necho %x%')
  assert.equal(r.stdout, '10\n6\n')
})

test('call, goto and exit codes', () => {
  const r = run('@echo off\ncall :greet World\ngoto end\necho skipped\n:greet\necho Hi %~1\nexit /b 0\n:end\necho bye\nexit /b 3')
  assert.equal(r.stdout, 'Hi World\nbye\n')
  assert.equal(r.exitCode, 3)
})

test('pipes, redirection and virtual files', () => {
  const r = run('@echo off\necho apple> fruit.txt\necho banana>> fruit.txt\ntype fruit.txt | find "ban"\n(echo b& echo a) | sort', { files: {} })
  assert.equal(r.stdout, 'banana\na\nb\n')
  assert.equal(r.files['fruit.txt'], 'apple\nbanana\n')
})

test('&& and || chains', () => {
  const r = run('@echo off\nnosuchcmd 2>nul || echo failed\necho ok && echo chained')
  assert.equal(r.stdout, 'failed\nok\nchained\n')
})

test('infinite loops stop', () => {
  const r = run(':top\ngoto top', { maxSteps: 1000 })
  assert.match(r.stderr, /Step limit/)
  assert.equal(r.exitCode, 1)
})

test('stdin with set /p and env from requests', () => {
  const r = run('@echo off\nset /p WHO=\necho %WHO% via %VIX_METHOD%', { stdin: 'tester\n', env: { VIX_METHOD: 'GET' } })
  assert.equal(r.stdout, 'tester via GET\n')
})

test('echo on prints the prompt', () => {
  const r = run('echo hi')
  assert.equal(r.stdout, 'C:\\vix>echo hi\nhi\n')
})
