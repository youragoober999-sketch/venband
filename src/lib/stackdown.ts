// Stackdown — Venband's falling-blocks battle game (an original game: its own
// name, colours and look). Pure game logic, no DOM, so it's unit-testable
// (tests/stackdown.test.ts). The component (components/Stackdown.tsx) draws it
// and syncs players over realtime.
//
// Rules: pieces fall into a 10×20 well; full rows clear. Clearing 2 / 3 / 4
// rows at once sends 1 / 2 / 4 rows of "junk" (with one gap) to your opponents.
// Junk you receive rises from the bottom when your next piece lands. Last one
// standing wins; alone, play for score.

export const COLS = 10;
export const ROWS = 20;
const HIDDEN = 2; // spawn rows above the visible well
export const H = ROWS + HIDDEN;
export const JUNK = 8;

// Seven shapes as (x, y) cells in spawn rotation; index 1..7 = colour index.
const SHAPES: [number, number][][] = [
  [], // 0 = empty
  [[0, 1], [1, 1], [2, 1], [3, 1]], // bar
  [[0, 0], [1, 0], [0, 1], [1, 1]], // square
  [[1, 0], [0, 1], [1, 1], [2, 1]], // tee
  [[1, 0], [2, 0], [0, 1], [1, 1]], // zig
  [[0, 0], [1, 0], [1, 1], [2, 1]], // zag
  [[0, 0], [0, 1], [1, 1], [2, 1]], // hook
  [[2, 0], [0, 1], [1, 1], [2, 1]], // crook
];
// Venband's own palette (index = piece kind; 8 = junk)
export const COLORS = ['', '#ff5d8f', '#ffd166', '#7c5cff', '#2dd4bf', '#60a5fa', '#a3e635', '#fb923c', '#5b6170'];
const SIZE = [0, 4, 2, 3, 3, 3, 3, 3]; // bounding box for rotation

export interface Piece {
  kind: number;
  rot: number;
  x: number;
  y: number;
}

/** Deterministic random (mulberry32) so a seed gives everyone fair, separate bags. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cells of a piece at its rotation, in well coordinates. */
export function cells(p: Piece): [number, number][] {
  const n = SIZE[p.kind];
  return SHAPES[p.kind].map(([x, y]) => {
    let cx = x;
    let cy = y;
    for (let i = 0; i < ((p.rot % 4) + 4) % 4; i++) [cx, cy] = [n - 1 - cy, cx];
    return [p.x + cx, p.y + cy] as [number, number];
  });
}

export class Game {
  board: number[]; // H × COLS, row-major, 0 = empty
  piece: Piece | null = null;
  next: number[] = [];
  hold = 0;
  canHold = true;
  score = 0;
  lines = 0;
  level = 1;
  alive = true;
  pendingJunk = 0;
  private rand: () => number;
  private dropTimer = 0;
  private lockTimer = 0;
  /** rows to send to opponents after the last lock (read and reset by the caller) */
  outgoing = 0;

  constructor(seed: number) {
    this.board = new Array(H * COLS).fill(0);
    this.rand = rng(seed);
    this.refill();
    this.spawn();
  }

  private refill() {
    while (this.next.length < 7) {
      const bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.next.push(...bag);
    }
  }

  at(x: number, y: number) {
    return this.board[y * COLS + x];
  }

  fits(p: Piece) {
    return cells(p).every(([x, y]) => x >= 0 && x < COLS && y < H && (y < 0 || this.at(x, y) === 0));
  }

  private spawn(kind?: number) {
    const k = kind ?? this.next.shift()!;
    this.refill();
    const p: Piece = { kind: k, rot: 0, x: k === 2 ? 4 : 3, y: 0 };
    this.piece = p;
    this.canHold = kind === undefined ? true : this.canHold;
    if (!this.fits(p)) {
      this.alive = false;
      this.piece = null;
    }
  }

  move(dx: number) {
    if (!this.piece) return false;
    const p = { ...this.piece, x: this.piece.x + dx };
    if (!this.fits(p)) return false;
    this.piece = p;
    this.lockTimer = 0;
    return true;
  }

  /** Rotate (1 = clockwise, -1 = counter-clockwise) with simple wall kicks. */
  rotate(dir: 1 | -1) {
    if (!this.piece || this.piece.kind === 2) return false;
    for (const [kx, ky] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]]) {
      const p = { ...this.piece, rot: this.piece.rot + dir, x: this.piece.x + kx, y: this.piece.y + ky };
      if (this.fits(p)) {
        this.piece = p;
        this.lockTimer = 0;
        return true;
      }
    }
    return false;
  }

  /** Where the piece would land (for the ghost). */
  ghost(): Piece | null {
    if (!this.piece) return null;
    let p = this.piece;
    while (this.fits({ ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
    return p;
  }

  softDrop() {
    if (!this.piece) return;
    if (this.fits({ ...this.piece, y: this.piece.y + 1 })) {
      this.piece = { ...this.piece, y: this.piece.y + 1 };
      this.score += 1;
    } else this.lock();
  }

  hardDrop() {
    const g = this.ghost();
    if (!g || !this.piece) return;
    this.score += 2 * (g.y - this.piece.y);
    this.piece = g;
    this.lock();
  }

  swapHold() {
    if (!this.piece || !this.canHold) return;
    const k = this.piece.kind;
    if (this.hold) this.spawn(this.hold);
    else this.spawn();
    this.hold = k;
    this.canHold = false;
  }

  /** Junk received from an opponent: rises when your next piece lands. */
  receive(rows: number) {
    this.pendingJunk = Math.min(20, this.pendingJunk + rows);
  }

  private lock() {
    if (!this.piece) return;
    for (const [x, y] of cells(this.piece)) if (y >= 0) this.board[y * COLS + x] = this.piece.kind;
    this.piece = null;
    // clear full rows
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < COLS; x++) if (!this.at(x, y)) full = false;
      if (full) {
        this.board.splice(y * COLS, COLS);
        this.board.unshift(...new Array(COLS).fill(0));
        cleared++;
        y++;
      }
    }
    if (cleared) {
      this.lines += cleared;
      this.score += [0, 100, 300, 500, 800][cleared] * this.level;
      this.level = 1 + Math.floor(this.lines / 10);
      const attack = [0, 0, 1, 2, 4][cleared];
      // clearing cancels junk that hasn't risen yet before it's sent on
      const cancel = Math.min(attack, this.pendingJunk);
      this.pendingJunk -= cancel;
      this.outgoing += attack - cancel;
    }
    if (this.pendingJunk && !cleared) this.raiseJunk();
    this.canHold = true;
    this.spawn();
  }

  private raiseJunk() {
    const n = this.pendingJunk;
    this.pendingJunk = 0;
    const gap = Math.floor(this.rand() * COLS);
    for (let i = 0; i < n; i++) {
      if (this.board.slice(0, COLS).some(Boolean)) this.alive = false; // pushed out of the top
      this.board.splice(0, COLS);
      const row = new Array(COLS).fill(JUNK);
      row[gap] = 0;
      this.board.push(...row);
    }
  }

  /** Advance time by dt ms: gravity and the short lock delay on the floor. */
  tick(dt: number) {
    if (!this.alive || !this.piece) return;
    const interval = Math.max(60, 800 * Math.pow(0.82, this.level - 1));
    if (this.fits({ ...this.piece, y: this.piece.y + 1 })) {
      this.dropTimer += dt;
      this.lockTimer = 0;
      while (this.dropTimer >= interval && this.piece && this.fits({ ...this.piece, y: this.piece.y + 1 })) {
        this.dropTimer -= interval;
        this.piece = { ...this.piece, y: this.piece.y + 1 };
      }
    } else {
      this.lockTimer += dt;
      if (this.lockTimer >= 450) {
        this.lockTimer = 0;
        this.dropTimer = 0;
        this.lock();
      }
    }
  }

  /** The visible well as one character per cell, for sending to opponents. */
  snapshot(): string {
    const b = this.board.slice();
    if (this.piece) for (const [x, y] of cells(this.piece)) if (y >= 0 && y < H) b[y * COLS + x] = this.piece.kind;
    return b.slice(HIDDEN * COLS).join('');
  }
}

export const VISIBLE_FROM = HIDDEN;
