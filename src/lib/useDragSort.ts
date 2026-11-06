// Drag-to-reorder that works everywhere: mouse, pen, touch (long-press, so
// normal scrolling still works) and keyboard (Alt + arrow keys). Built on
// pointer events instead of HTML5 drag-and-drop, which phones' webviews (the
// Android / iOS apps) don't support at all.
//
//   const sort = useDragSort({ where, onDrop, onKeyMove });
//   <div {...sort.bind(id, 'channel', canManage)} className={sort.classFor(id, 'channel')}>
//
// Every draggable element and drop target carries data-sort-id / data-sort-kind.
// While dragging, the element under the pointer (and its sortable ancestors,
// innermost first) is offered to `where`; the first non-null answer is the drop.
import { useCallback, useEffect, useRef, useState } from 'react';

export type DropWhere = 'before' | 'after' | 'into';
export interface SortKey {
  id: string;
  kind: string;
}
export interface DragSortOptions {
  /** Where `drag` would land on `target`. `rel` is the pointer position across the target (0 = top/left, 1 = bottom/right). null = can't drop here. */
  where: (drag: SortKey, target: SortKey, rel: number) => DropWhere | null;
  onDrop: (drag: SortKey, target: SortKey, where: DropWhere) => void;
  /** Alt + ↑/↓ (or ←/→ on a horizontal list) on a focused item. */
  onKeyMove?: (key: SortKey, dir: -1 | 1) => void;
  axis?: 'x' | 'y';
}
export interface DragState {
  drag: SortKey | null;
  over: (SortKey & { where: DropWhere }) | null;
}

const LONG_PRESS_MS = 320;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 9;

function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth)) return n;
  }
  return null;
}

export function useDragSort(opts: DragSortOptions) {
  const [state, setState] = useState<DragState>({ drag: null, over: null });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const live = useRef<{
    key: SortKey;
    el: HTMLElement;
    x0: number;
    y0: number;
    touch: boolean;
    active: boolean;
    timer: number;
    ghost: HTMLElement | null;
    dx: number;
    dy: number;
    over: DragState['over'];
    scroller: HTMLElement | null;
    scrollV: number;
    raf: number;
  } | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  const finish = useCallback((drop: boolean) => {
    const l = live.current;
    live.current = null;
    cleanupRef.current();
    if (!l) return;
    clearTimeout(l.timer);
    cancelAnimationFrame(l.raf);
    l.ghost?.remove();
    document.body.classList.remove('sorting');
    if (l.active) {
      // the click that ends a drag must not also open the item
      const swallow = (e: Event) => (e.stopPropagation(), e.preventDefault());
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      setState({ drag: null, over: null });
      if (drop && l.over) optsRef.current.onDrop(l.key, { id: l.over.id, kind: l.over.kind }, l.over.where);
    }
  }, []);

  useEffect(() => () => finish(false), [finish]);

  const activate = useCallback(() => {
    const l = live.current;
    if (!l || l.active) return;
    l.active = true;
    const r = l.el.getBoundingClientRect();
    l.dx = l.x0 - r.left;
    l.dy = l.y0 - r.top;
    const g = l.el.cloneNode(true) as HTMLElement;
    g.removeAttribute('data-sort-id');
    g.classList.add('sort-ghost');
    Object.assign(g.style, { position: 'fixed', left: '0', top: '0', width: `${r.width}px`, height: `${r.height}px`, margin: '0', pointerEvents: 'none', zIndex: '10000', transform: `translate(${r.left}px, ${r.top}px)` });
    document.body.appendChild(g);
    l.ghost = g;
    l.scroller = scrollParent(l.el);
    document.body.classList.add('sorting');
    if (l.touch) navigator.vibrate?.(12);
    setState({ drag: l.key, over: null });
  }, []);

  const track = useCallback((x: number, y: number) => {
    const l = live.current;
    if (!l?.active) return;
    if (l.ghost) l.ghost.style.transform = `translate(${x - l.dx}px, ${y - l.dy}px)`;
    // auto-scroll near the edges of the list
    if (l.scroller) {
      const r = l.scroller.getBoundingClientRect();
      const edge = Math.min(48, r.height / 4);
      l.scrollV = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 4) : y > r.bottom - edge ? Math.ceil((y - (r.bottom - edge)) / 4) : 0;
      if (l.scrollV && !l.raf) {
        const step = () => {
          const c = live.current;
          if (!c?.scroller || !c.scrollV) return void (c && (c.raf = 0));
          c.scroller.scrollTop += c.scrollV;
          c.raf = requestAnimationFrame(step);
        };
        l.raf = requestAnimationFrame(step);
      }
    }
    let over: DragState['over'] = null;
    let n = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sort-id]') ?? null;
    while (n) {
      const target = { id: n.dataset.sortId!, kind: n.dataset.sortKind ?? '' };
      const box = n.getBoundingClientRect();
      const rel = (optsRef.current.axis ?? 'y') === 'y' ? (y - box.top) / Math.max(1, box.height) : (x - box.left) / Math.max(1, box.width);
      const isSelf = target.id === l.key.id && target.kind === l.key.kind;
      const where = isSelf ? null : optsRef.current.where(l.key, target, Math.min(1, Math.max(0, rel)));
      if (where) {
        over = { ...target, where };
        break;
      }
      if (isSelf) break;
      n = n.parentElement?.closest<HTMLElement>('[data-sort-id]') ?? null;
    }
    const prev = l.over;
    if (prev?.id !== over?.id || prev?.kind !== over?.kind || prev?.where !== over?.where) {
      l.over = over;
      setState({ drag: l.key, over });
    }
  }, []);

  const begin = useCallback(
    (e: React.PointerEvent<HTMLElement>, key: SortKey) => {
      if (e.button !== 0 || live.current) return;
      // a button / field inside the item (gear, add…) keeps working normally
      const inner = (e.target as HTMLElement).closest('button, a, input, select, textarea, [contenteditable="true"]');
      if (inner && inner !== e.currentTarget && e.currentTarget.contains(inner)) return;
      const touch = e.pointerType === 'touch';
      live.current = { key, el: e.currentTarget, x0: e.clientX, y0: e.clientY, touch, active: false, timer: 0, ghost: null, dx: 0, dy: 0, over: null, scroller: null, scrollV: 0, raf: 0 };
      if (touch) live.current.timer = window.setTimeout(activate, LONG_PRESS_MS);

      const move = (ev: PointerEvent) => {
        const l = live.current;
        if (!l) return;
        if (!l.active) {
          const dist = Math.hypot(ev.clientX - l.x0, ev.clientY - l.y0);
          if (l.touch) {
            if (dist > TOUCH_SLOP) finish(false); // it's a scroll, not a drag
            return;
          }
          if (dist < MOUSE_SLOP) return;
          activate();
        }
        ev.preventDefault();
        track(ev.clientX, ev.clientY);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key_ = (ev: KeyboardEvent) => ev.key === 'Escape' && live.current?.active && (ev.preventDefault(), finish(false));
      // once a touch drag has started the page must not scroll under the finger
      const touchmove = (ev: TouchEvent) => live.current?.active && ev.cancelable && ev.preventDefault();
      // long-press on Android also fires contextmenu; don't open the menu mid-drag
      const ctx = (ev: Event) => live.current?.active && (ev.preventDefault(), ev.stopPropagation());
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key_, true);
      window.addEventListener('touchmove', touchmove, { passive: false });
      window.addEventListener('contextmenu', ctx, true);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', key_, true);
        window.removeEventListener('touchmove', touchmove);
        window.removeEventListener('contextmenu', ctx, true);
      };
    },
    [activate, finish, track],
  );

  /** Props for a draggable item / drop target. `draggable = false` → drop target only. */
  const bind = useCallback(
    (id: string, kind: string, draggable = true) => ({
      'data-sort-id': id,
      'data-sort-kind': kind,
      ...(draggable ? { 'data-sortable': '', onPointerDown: (e: React.PointerEvent<HTMLElement>) => begin(e, { id, kind }) } : {}),
    }),
    [begin],
  );

  /** Alt + arrows moves the focused item; call from the item's onKeyDown. */
  const keyDown = useCallback((e: React.KeyboardEvent, id: string, kind: string) => {
    if (!e.altKey || !optsRef.current.onKeyMove) return false;
    const vertical = (optsRef.current.axis ?? 'y') === 'y';
    const dir = e.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 : e.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 1 : 0;
    if (!dir) return false;
    e.preventDefault();
    e.stopPropagation();
    optsRef.current.onKeyMove({ id, kind }, dir);
    return true;
  }, []);

  /** " dragging" / " drop-before|after|into" for the element with this key. */
  const classFor = (id: string, kind: string) =>
    `${state.drag?.id === id && state.drag.kind === kind ? ' dragging' : ''}${state.over?.id === id && state.over.kind === kind ? ` drop-${state.over.where}` : ''}`;

  return { state, bind, keyDown, classFor };
}
