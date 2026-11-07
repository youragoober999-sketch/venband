// The macOS-style dock (Settings → Appearance → Dock style): a floating glass
// dock with real magnification that follows the pointer, a bounce when you open
// something, open / unread indicators, labels, drag to reorder and keyboard
// support. The rest of the app makes room for it, so it never covers anything.
import { useEffect, useRef, useState } from 'react';
import type { DmChannel, Server } from '../lib/types';
import { openServer } from '../hooks/data';
import { pingCount, unreadStore } from '../lib/notify';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useDragSort, type DropWhere } from '../lib/useDragSort';
import { Icon, initials } from './ui';

/** Two chat bubbles: Home is where your messages live. */
function ChatGlyph() {
  // colours come from the theme (.dock-home in styles.css), so it matches every theme
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="dock-chat">
      <path className="back" d="M9.5 5.5h7a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-.5v2.4l-3.1-2.4H9.5a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z" transform="translate(1.8 -1.6)" />
      <path className="front" d="M6.5 7.5h8a3 3 0 0 1 3 3v4.2a3 3 0 0 1-3 3H10l-3.6 2.8v-2.8a3 3 0 0 1-2.9-3v-4.2a3 3 0 0 1 3-3z" />
      <circle className="dot" cx="7.9" cy="12.6" r="1.05" />
      <circle className="dot" cx="10.8" cy="12.6" r="1.05" />
      <circle className="dot" cx="13.7" cy="12.6" r="1.05" />
    </svg>
  );
}

export type DockPosition = 'top' | 'left' | 'right' | 'bottom' | 'custom';

const MAX_SCALE = 1.75; // how big the icon under the pointer gets
const RANGE = 150; // px either side of the pointer that grow

function DockItem({
  id,
  label,
  active,
  unread,
  mentions,
  onOpen,
  children,
  extra,
  className = '',
}: {
  id: string;
  label: string;
  active?: boolean;
  unread?: boolean;
  mentions?: number;
  onOpen: () => void;
  children: React.ReactNode;
  extra?: Record<string, unknown>;
  className?: string;
}) {
  const [launching, setLaunching] = useState(false);
  return (
    <button
      className={`dock-item${active ? ' active' : ''}${launching ? ' launching' : ''} ${className}`}
      data-dock-id={id}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        setLaunching(true);
        window.setTimeout(() => setLaunching(false), 820);
        onOpen();
      }}
      {...extra}
    >
      <span className="dock-icon">{children}</span>
      {mentions ? <span className="dock-badge">{pingCount(mentions)}</span> : null}
      <span className="dock-tip">{label}</span>
      <span className={`dock-dot${active ? ' on' : unread ? ' unread' : ''}`} />
    </button>
  );
}

export function MacDock({
  servers,
  dms,
  current,
  onAdd,
  discover,
  onDiscover,
  position,
}: {
  servers: Server[];
  dms: DmChannel[];
  current: string | null;
  onAdd: () => void;
  discover: boolean;
  onDiscover: () => void;
  position: DockPosition;
}) {
  const unread = unreadStore.use((s) => s);
  const dmUnread = dms.reduce((n, d) => n + (unread.counts[d.channel.id] ?? 0), 0);
  const railOrder = useSettings((s) => s.rail.order);
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const pos = position === 'custom' ? 'bottom' : position;
  const vertical = pos === 'left' || pos === 'right';
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const sorted = [...servers].sort((a, b) => {
    const ra = railOrder.indexOf(a.id);
    const rb = railOrder.indexOf(b.id);
    return (ra === -1 ? 9999 : ra) - (rb === -1 ? 9999 : rb);
  });
  const stateOf = (id: string) => {
    const chans = Object.keys(unread.counts).filter((c) => unread.serverOf[c] === id);
    return { any: chans.length > 0, mentions: chans.reduce((n, c) => n + (unread.mentions[c] ?? 0), 0) };
  };

  // ---- magnification: every icon grows by how close it is to the pointer
  const magnify = (clientX: number, clientY: number) => {
    const dock = ref.current;
    if (!dock || still) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      dock.querySelectorAll<HTMLElement>('.dock-item').forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(vertical ? clientY - (r.top + r.height / 2) : clientX - (r.left + r.width / 2));
        const k = d >= RANGE ? 0 : Math.cos((d / RANGE) * (Math.PI / 2)) ** 2;
        el.style.setProperty('--m', (1 + (MAX_SCALE - 1) * k).toFixed(3));
      });
    });
  };
  const rest = () => {
    cancelAnimationFrame(raf.current);
    ref.current?.querySelectorAll<HTMLElement>('.dock-item').forEach((el) => el.style.setProperty('--m', '1'));
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---- drag to reorder servers (same order as the classic server rail)
  const moveInDock = (id: string, target: string, where: DropWhere) => {
    const ids = sorted.map((s) => s.id).filter((x) => x !== id);
    const i = ids.indexOf(target);
    if (i === -1) return;
    ids.splice(where === 'before' ? i : i + 1, 0, id);
    const others = getSettings().rail.order.filter((k) => !ids.includes(k));
    updateSettings((st) => ({ rail: { ...st.rail, order: [...ids, ...others] } }));
  };
  const sort = useDragSort({
    axis: vertical ? 'y' : 'x',
    where: (_d, t, rel) => (t.kind === 'dock' ? (rel < 0.5 ? 'before' : 'after') : null),
    onDrop: (d, t, where) => moveInDock(d.id, t.id, where),
    onKeyMove: (k, dir) => {
      const ids = sorted.map((s) => s.id);
      const n = ids[ids.indexOf(k.id) + dir];
      if (n) moveInDock(k.id, n, dir < 0 ? 'before' : 'after');
    },
  });
  const dragging = Boolean(sort.state.drag);
  useEffect(() => {
    if (dragging) rest();
  }, [dragging]);

  return (
    <nav
      ref={ref}
      className={`vb-dock dock-${pos}${still ? ' still' : ''}`}
      style={{ ['--dock-count' as string]: sorted.length + 3 }}
      aria-label="Dock"
      onPointerMove={(e) => !dragging && e.pointerType === 'mouse' && magnify(e.clientX, e.clientY)}
      onPointerLeave={rest}
    >
      <DockItem id="home" label="Home & messages" active={current === null && !discover} mentions={dmUnread} onOpen={() => openServer(null)} className="dock-home">
        <ChatGlyph />
      </DockItem>
      {sorted.length > 0 && <span className="dock-sep" aria-hidden />}
      {sorted.map((s) => {
        const st = stateOf(s.id);
        return (
          <DockItem
            key={s.id}
            id={s.id}
            label={s.name}
            active={s.id === current}
            unread={st.any}
            mentions={st.mentions}
            onOpen={() => openServer(s.id)}
            className={sort.classFor(s.id, 'dock')}
            extra={{ ...sort.bind(s.id, 'dock'), onKeyDown: (e: React.KeyboardEvent) => sort.keyDown(e, s.id, 'dock') }}
          >
            {s.icon_url ? (
              <img src={s.icon_url} alt="" draggable={false} />
            ) : (
              <span className="dock-initials" style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${s.icon_color} 75%, white), ${s.icon_color} 55%, color-mix(in srgb, ${s.icon_color} 70%, black))` }}>
                {initials(s.name)}
              </span>
            )}
          </DockItem>
        );
      })}
      <span className="dock-sep" aria-hidden />
      <DockItem id="discover" label="Discover servers" active={discover} onOpen={onDiscover} className="dock-discover">
        <Icon name="compass" size={24} />
      </DockItem>
      <DockItem id="add" label="Create or join a server" onOpen={onAdd} className="dock-add">
        <Icon name="plus" size={24} />
      </DockItem>
    </nav>
  );
}
