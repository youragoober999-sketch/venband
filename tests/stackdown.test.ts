import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, Game, H, JUNK, ROWS, cells } from '../src/lib/stackdown.ts';

test('the same seed deals the same pieces; a bag holds all seven', () => {
  const a = new Game(42);
  const b = new Game(42);
  assert.deepEqual(a.next.slice(0, 7), b.next.slice(0, 7));
  const g = new Game(7);
  const firstBag = [g.piece!.kind, ...g.next.slice(0, 6)].sort();
  assert.deepEqual(firstBag, [1, 2, 3, 4, 5, 6, 7]);
});

test('moving stops at the walls; rotating keeps four cells inside the well', () => {
  const g = new Game(1);
  for (let i = 0; i < 20; i++) g.move(-1);
  assert.ok(cells(g.piece!).every(([x]) => x >= 0));
  for (let i = 0; i < 20; i++) g.move(1);
  assert.ok(cells(g.piece!).every(([x]) => x < COLS));
  for (let r = 0; r < 4; r++) {
    g.rotate(1);
    assert.equal(cells(g.piece!).length, 4);
    assert.ok(cells(g.piece!).every(([x]) => x >= 0 && x < COLS));
  }
});

test('hard drop lands the piece on the floor and spawns the next one', () => {
  const g = new Game(3);
  const kind = g.piece!.kind;
  g.hardDrop();
  assert.ok(g.board.slice((H - 1) * COLS).some((c) => c === kind), 'something landed on the bottom row');
  assert.ok(g.piece, 'next piece spawned');
  assert.ok(g.score > 0);
});

test('a full row clears; two rows at once send one row of junk', () => {
  const g = new Game(5);
  // fill the bottom two rows except one column, then drop a vertical bar there
  for (let y = H - 2; y < H; y++) for (let x = 0; x < COLS - 1; x++) g.board[y * COLS + x] = JUNK;
  g.piece = { kind: 1, rot: 1, x: COLS - 3, y: 0 }; // bar standing up in the last column
  assert.ok(cells(g.piece).every(([x]) => x === COLS - 1));
  g.hardDrop();
  assert.equal(g.lines, 2);
  assert.equal(g.outgoing, 1);
  assert.ok(g.board.slice((H - 2) * COLS).filter(Boolean).length <= 2, 'the two full rows are gone');
});

test('received junk rises from the bottom with one gap when the next piece lands', () => {
  const g = new Game(9);
  g.receive(3);
  g.hardDrop();
  for (let y = H - 3; y < H; y++) {
    const row = g.board.slice(y * COLS, (y + 1) * COLS);
    assert.equal(row.filter((c) => c === JUNK).length, COLS - 1, `row ${y} is junk with one gap`);
  }
});

test('topping out ends the game; the snapshot covers the visible well', () => {
  const g = new Game(11);
  for (let i = 0; i < 200 && g.alive; i++) g.hardDrop();
  assert.equal(g.alive, false);
  assert.equal(new Game(1).snapshot().length, ROWS * COLS);
});
