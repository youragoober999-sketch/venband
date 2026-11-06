// Activities: games you play together in a channel. Stackdown is the first —
// an original falling-blocks battle (src/lib/stackdown.ts). Everyone in the
// channel who opens it lands in the same lobby (realtime topic act:<channel>).
// Each player runs their own game; boards, scores and junk attacks are sent
// to the others a few times a second.
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { COLORS, COLS, Game, ROWS, VISIBLE_FROM, cells } from '../lib/stackdown';
import { sfx } from '../lib/sfx';
import { Icon, Modal } from './ui';

interface Player {
  id: string;
  name: string;
}
interface Remote {
  board: string;
  score: number;
  lines: number;
  alive: boolean;
}
type Phase = 'lobby' | 'countdown' | 'playing' | 'over';

const CELL = 26;

function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, ghost = false) {
  const pad = Math.max(1, s * 0.06);
  const r = s * 0.22;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, s - pad * 2, s - pad * 2, r);
  if (ghost) {
    ctx.strokeStyle = color + 'aa';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.stroke();
    return;
  }
  const g = ctx.createLinearGradient(x, y, x, y + s);
  g.addColorStop(0, color);
  g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g;
  ctx.fill();
  // a soft highlight on top
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath();
  ctx.roundRect(x + pad * 2, y + pad * 2, s - pad * 4, (s - pad * 4) * 0.35, r * 0.6);
  ctx.fill();
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c : 255 - c) * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawWell(ctx: CanvasRenderingContext2D, board: string, s: number, game?: Game) {
  const w = COLS * s;
  const h = ROWS * s;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b0c12';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * s + 0.5, 0);
    ctx.lineTo(x * s + 0.5, h);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * s + 0.5);
    ctx.lineTo(w, y * s + 0.5);
    ctx.stroke();
  }
  if (game) {
    const ghost = game.ghost();
    if (ghost && game.piece) for (const [x, y] of cells(ghost)) if (y >= VISIBLE_FROM) drawBlock(ctx, x * s, (y - VISIBLE_FROM) * s, s, COLORS[game.piece.kind], true);
  }
  for (let i = 0; i < board.length; i++) {
    const v = board.charCodeAt(i) - 48;
    if (v > 0) drawBlock(ctx, (i % COLS) * s, Math.floor(i / COLS) * s, s, COLORS[v]);
  }
}

function Preview({ kind, size = 14 }: { kind: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size * 4, size * 3);
    if (!kind) return;
    const cs = cells({ kind, rot: 0, x: 0, y: 0 });
    const minX = Math.min(...cs.map((c) => c[0]));
    const maxX = Math.max(...cs.map((c) => c[0]));
    const minY = Math.min(...cs.map((c) => c[1]));
    const ox = (4 - (maxX - minX + 1)) / 2 - minX;
    for (const [x, y] of cs) drawBlock(ctx, (x + ox) * size, (y - minY + 0.5) * size, size, COLORS[kind]);
  }, [kind, size]);
  return <canvas ref={ref} width={size * 4} height={size * 3} className="sd-preview" />;
}

function MiniWell({ board }: { board: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawWell(ctx, board, 8);
  }, [board]);
  return <canvas ref={ref} width={COLS * 8} height={ROWS * 8} className="sd-mini" />;
}

export function Stackdown({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [phase, setPhase] = useState<Phase>('lobby');
  const [players, setPlayers] = useState<Player[]>([]);
  const [remote, setRemote] = useState<Record<string, Remote>>({});
  const [count, setCount] = useState(3);
  const [, setFrame] = useState(0);
  const [connected, setConnected] = useState(false);
  const [won, setWon] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Game | null>(null);
  const rt = useRef<RealtimeChannel | null>(null);
  const multi = useRef(false);
  const remoteRef = useRef<Record<string, Remote>>({});
  remoteRef.current = remote;

  // ---- realtime lobby
  useEffect(() => {
    const ch = supabase.channel(`act:${channelId}`, { config: { private: true, presence: { key: me.id }, broadcast: { self: false } } });
    rt.current = ch;
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState<Player>();
      setPlayers(Object.values(st).map((m) => m[m.length - 1]).filter((p): p is Player & { presence_ref: string } => Boolean(p?.id)).map((p) => ({ id: p.id, name: p.name })));
    });
    ch.on('broadcast', { event: 'start' }, ({ payload }) => begin(payload.seed as number, payload.at as number, true));
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      const p = payload as Remote & { id: string };
      setRemote((r) => ({ ...r, [p.id]: { board: p.board, score: p.score, lines: p.lines, alive: p.alive } }));
    });
    ch.on('broadcast', { event: 'junk' }, ({ payload }) => {
      if (payload.to === me.id && game.current?.alive) {
        game.current.receive(payload.n as number);
        sfx('error');
      }
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        void ch.track({ id: me.id, name: me.display_name || me.username });
      }
    });
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  function begin(seed: number, at: number, fromOthers = false) {
    game.current = new Game(seed);
    multi.current = players.length > 1 || fromOthers;
    setRemote({});
    setWon(false);
    setPhase('countdown');
    const tick = () => {
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left > 0) {
        setCount(left);
        window.setTimeout(tick, 200);
      } else {
        setPhase('playing');
        sfx('call_connect');
      }
    };
    tick();
  }
  function start() {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const at = Date.now() + 3000;
    void rt.current?.send({ type: 'broadcast', event: 'start', payload: { seed, at } });
    begin(seed, at);
  }

  // ---- game loop + sending our state
  useEffect(() => {
    if (phase !== 'playing') return;
    // timers, not requestAnimationFrame: a backgrounded tab keeps playing and
    // keeps telling the others its state (rAF stops entirely when hidden)
    let timer = 0;
    let last = performance.now();
    let sentAt = 0;
    const loop = () => {
      const t = performance.now();
      const g = game.current;
      if (!g) return;
      g.tick(t - last);
      last = t;
      if (g.outgoing) {
        const targets = Object.entries(remoteRef.current).filter(([id, r]) => r.alive && id !== me.id).map(([id]) => id);
        const to = targets[Math.floor(Math.random() * targets.length)];
        if (to) void rt.current?.send({ type: 'broadcast', event: 'junk', payload: { to, n: g.outgoing } });
        g.outgoing = 0;
      }
      const ctx = canvas.current?.getContext('2d');
      if (ctx) drawWell(ctx, g.snapshot(), CELL, g);
      if (t - sentAt > 200 || !g.alive) {
        sentAt = t;
        void rt.current?.send({ type: 'broadcast', event: 'state', payload: { id: me.id, board: g.snapshot(), score: g.score, lines: g.lines, alive: g.alive } });
        setFrame((f) => f + 1);
      }
      if (!g.alive) {
        sfx('call_end');
        setPhase('over');
        return;
      }
      timer = window.setTimeout(loop, 16);
    };
    timer = window.setTimeout(loop, 16);
    return () => window.clearTimeout(timer);
  }, [phase, me.id]);

  // a multiplayer round ends when you're the last one standing
  useEffect(() => {
    if (phase !== 'playing' || !multi.current) return;
    const others = Object.values(remote);
    if (others.length && others.every((r) => !r.alive) && game.current?.alive) {
      setWon(true);
      sfx('mention');
      setPhase('over');
    }
  }, [remote, phase]);

  // ---- controls
  useEffect(() => {
    if (phase !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      const g = game.current;
      if (!g || (e.target instanceof Element && e.target.closest('input, textarea'))) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => unknown> = {
        arrowleft: () => g.move(-1),
        a: () => g.move(-1),
        arrowright: () => g.move(1),
        d: () => g.move(1),
        arrowdown: () => g.softDrop(),
        s: () => g.softDrop(),
        arrowup: () => g.rotate(1),
        x: () => g.rotate(1),
        w: () => g.rotate(1),
        z: () => g.rotate(-1),
        ' ': () => g.hardDrop(),
        c: () => g.swapHold(),
        shift: () => g.swapHold(),
      };
      if (map[k]) {
        e.preventDefault();
        if (k === ' ' && e.repeat) return;
        map[k]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const g = game.current;
  const touch = (fn: (g: Game) => void) => () => game.current && phase === 'playing' && fn(game.current);

  return (
    <Modal title="Stackdown" onClose={onClose} wide>
      {phase === 'lobby' && (
        <div className="sd-lobby">
          <p className="muted small">
            Clear rows to score. Clear 2, 3 or 4 at once to send junk rows to the others — last one standing wins. Everyone in this channel who opens
            Stackdown joins this lobby.
          </p>
          <div className="sd-players">
            {players.map((p) => (
              <span key={p.id} className="sd-player">
                <Icon name="gamepad" size={14} /> {p.id === me.id ? `${p.name} (you)` : p.name}
              </span>
            ))}
            {!connected && <span className="small muted">Connecting…</span>}
          </div>
          <div className="sd-keys small muted">← → move · ↑ / X rotate · Z rotate back · ↓ soft drop · Space hard drop · C hold</div>
          <div className="modal-actions">
            <button className="btn primary" onClick={start} disabled={!connected}>
              {players.length > 1 ? `Start for ${players.length} players` : 'Play solo'}
            </button>
          </div>
        </div>
      )}
      {(phase === 'countdown' || phase === 'playing' || phase === 'over') && g && (
        <div className="sd-arena">
          <div className="sd-side">
            <div className="sd-label">Hold</div>
            <Preview kind={g.hold} />
            <div className="sd-stat">
              <span>Score</span>
              <b>{g.score.toLocaleString()}</b>
            </div>
            <div className="sd-stat">
              <span>Lines</span>
              <b>{g.lines}</b>
            </div>
            <div className="sd-stat">
              <span>Level</span>
              <b>{g.level}</b>
            </div>
            {g.pendingJunk > 0 && <div className="sd-incoming">⚠ {g.pendingJunk} incoming</div>}
          </div>
          <div className="sd-well-wrap">
            <canvas ref={canvas} width={COLS * CELL} height={ROWS * CELL} className="sd-well" />
            {phase === 'countdown' && <div className="sd-overlay big">{count}</div>}
            {phase === 'over' && (
              <div className="sd-overlay">
                <b>{multi.current ? (won ? 'You win! 🏆' : 'Knocked out') : 'Game over'}</b>
                <span>{g.score.toLocaleString()} points · {g.lines} lines</span>
                <button className="btn primary small" onClick={() => setPhase('lobby')}>
                  Back to lobby
                </button>
              </div>
            )}
          </div>
          <div className="sd-side">
            <div className="sd-label">Next</div>
            {g.next.slice(0, 3).map((k, i) => (
              <Preview key={i} kind={k} size={i === 0 ? 14 : 11} />
            ))}
            {Object.keys(remote).length > 0 && (
              <div className="sd-opponents">
                {Object.entries(remote).map(([id, r]) => (
                  <div key={id} className={`sd-opponent${r.alive ? '' : ' out'}`}>
                    <MiniWell board={r.board} />
                    <span className="small">{players.find((p) => p.id === id)?.name ?? 'Player'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="sd-touch" aria-hidden>
            <button onPointerDown={touch((x) => x.move(-1))}>◀</button>
            <button onPointerDown={touch((x) => x.rotate(1))}>⟳</button>
            <button onPointerDown={touch((x) => x.move(1))}>▶</button>
            <button onPointerDown={touch((x) => x.softDrop())}>▼</button>
            <button onPointerDown={touch((x) => x.hardDrop())}>⤓</button>
            <button onPointerDown={touch((x) => x.swapHold())}>Hold</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
