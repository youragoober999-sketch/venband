// App-wide right-click menus. The browser's own menu is turned off everywhere;
// text fields get a small Cut / Copy / Paste menu instead.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createStore } from '../lib/store';
import { Icon } from './ui';

export type MenuItem =
  | { type?: 'item'; label: string; icon?: string; danger?: boolean; disabled?: boolean; hint?: string; onClick: () => void }
  | { type: 'check'; label: string; checked: boolean; onChange: (v: boolean) => void }
  | { type: 'slider'; label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void }
  | { type: 'header'; label: ReactNode }
  | { type: 'custom'; render: (close: () => void) => ReactNode }
  | { type: 'sep' };

export type Entry = MenuItem | false | null | undefined | 0 | "";

const menuStore = createStore<{ open: { x: number; y: number; items: MenuItem[] } | null }>({ open: null });

const HANDLED = Symbol('venband-menu');

/** Open a menu at the pointer. Falsy entries are skipped (handy for conditions). */
export function openMenu(e: ReactMouseEvent | MouseEvent, entries: Entry[]) {
  e.preventDefault();
  e.stopPropagation();
  const native = ('nativeEvent' in e ? e.nativeEvent : e) as MouseEvent & { [HANDLED]?: boolean };
  native[HANDLED] = true;
  const items = entries.filter(Boolean) as MenuItem[];
  // drop leading / trailing / doubled separators
  const clean = items.filter((it, i) => it.type !== 'sep' || (i > 0 && i < items.length - 1 && items[i - 1].type !== 'sep'));
  menuStore.set({ open: { x: e.clientX, y: e.clientY, items: clean } });
}

/** Open a menu below an element (for "…" buttons). */
export function openMenuAt(el: HTMLElement, entries: Entry[]) {
  const r = el.getBoundingClientRect();
  menuStore.set({ open: { x: r.left, y: r.bottom + 4, items: entries.filter(Boolean) as MenuItem[] } });
}

export function closeMenu() {
  menuStore.set({ open: null });
}

export function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function fieldMenu(el: HTMLInputElement | HTMLTextAreaElement): MenuItem[] {
  const selected = (el.selectionEnd ?? 0) > (el.selectionStart ?? 0);
  const editable = !el.readOnly && !el.disabled;
  const replaceSelection = (text: string) => {
    el.focus();
    // keeps React's onChange + the undo stack working
    document.execCommand('insertText', false, text);
  };
  return [
    {
      label: 'Cut',
      icon: 'scissors',
      disabled: !selected || !editable,
      onClick: () => {
        copyText(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
        replaceSelection('');
      },
    },
    { label: 'Copy', icon: 'copy', disabled: !selected, onClick: () => copyText(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)) },
    {
      label: 'Paste',
      icon: 'clipboard',
      disabled: !editable,
      onClick: () => navigator.clipboard?.readText().then(replaceSelection).catch(() => {}),
    },
    { type: 'sep' },
    { label: 'Select all', onClick: () => (el.focus(), el.select()) },
  ];
}

/** Mount once. Owns the global listeners and renders the open menu. */
export function ContextMenuHost() {
  const open = menuStore.use((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onContext = (e: MouseEvent & { [HANDLED]?: boolean }) => {
      if (e[HANDLED]) return;
      e.preventDefault();
      const t = e.target as HTMLElement;
      const field = t.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
      if (field && !['checkbox', 'radio', 'range', 'color', 'file'].includes((field as HTMLInputElement).type)) {
        menuStore.set({ open: { x: e.clientX, y: e.clientY, items: fieldMenu(field) } });
        return;
      }
      const sel = window.getSelection()?.toString();
      if (sel) menuStore.set({ open: { x: e.clientX, y: e.clientY, items: [{ label: 'Copy', icon: 'copy', onClick: () => copyText(sel) }] } });
      else closeMenu();
    };
    window.addEventListener('contextmenu', onContext);

    // Touch screens: press and hold = right-click (iPhones never send one).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number; target: EventTarget | null } | null = null;
    let nativeFired = false;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, target: e.target };
      nativeFired = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!start || nativeFired) return;
        const el = start.target as Element | null;
        if (!el || el.closest('input, textarea, [contenteditable]')) return;
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }));
        navigator.vibrate?.(12);
        start = null;
      }, 480);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
    };
    const onNative = () => {
      nativeFired = true; // Android sends its own long-press contextmenu
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', cancel);
    window.addEventListener('touchcancel', cancel);
    window.addEventListener('contextmenu', onNative, true);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', cancel);
      window.removeEventListener('touchcancel', cancel);
      window.removeEventListener('contextmenu', onNative, true);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    const onBlur = () => closeMenu();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onBlur);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onBlur);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  // keep it on screen
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(open.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(open.y, window.innerHeight - r.height - 8)),
    });
  }, [open]);

  if (!open) return null;
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {open.items.map((it, i) => {
        if (it.type === 'sep') return <div key={i} className="ctx-sep" />;
        if (it.type === 'header') return <div key={i} className="ctx-header">{it.label}</div>;
        if (it.type === 'custom') return <div key={i}>{it.render(closeMenu)}</div>;
        if (it.type === 'check')
          return (
            <button key={i} className="ctx-item" role="menuitemcheckbox" aria-checked={it.checked} onClick={() => (it.onChange(!it.checked), closeMenu())}>
              <span>{it.label}</span>
              <span className={`ctx-check${it.checked ? ' on' : ''}`}>{it.checked && <Icon name="check" size={13} />}</span>
            </button>
          );
        if (it.type === 'slider') return <SliderItem key={i} item={it} />;
        return (
          <button
            key={i}
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            role="menuitem"
            onClick={() => {
              closeMenu();
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint ? <span className="ctx-hint">{it.hint}</span> : it.icon ? <Icon name={it.icon} size={16} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SliderItem({ item }: { item: Extract<MenuItem, { type: 'slider' }> }) {
  const [v, setV] = useState(item.value);
  return (
    <div className="ctx-slider">
      <div className="ctx-slider-top">
        <span>{item.label}</span>
        <span className="ctx-hint">{item.format ? item.format(v) : v}</span>
      </div>
      <input
        type="range"
        min={item.min}
        max={item.max}
        step={item.step ?? 1}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          item.onChange(n);
        }}
      />
    </div>
  );
}
