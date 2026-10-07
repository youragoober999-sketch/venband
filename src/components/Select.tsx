// Themed dropdown that replaces the native <select>, whose popup list (and its
// scrollbar) is drawn by the operating system and ignores Venband's theme.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

export type SelectOption = { value: string; label: string; hint?: string; icon?: ReactNode; disabled?: boolean; group?: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  searchable,
  className,
  title,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const search = searchable ?? options.length > 8;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : options;
  }, [q, options]);
  const current = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = Math.min(320, Math.max(120, shown.length * 38 + 56));
    const below = vh - r.bottom;
    const up = below < h && r.top > below;
    const width = Math.min(Math.max(r.width, 200), vw - 16);
    const maxLeft = Math.min(vw - 8, r.right - 8) - width;
    const left = Math.max(8, Math.min(r.left, maxLeft));
    const top = up ? Math.max(8, r.top - h - 6) : Math.min(vh - h - 8, Math.max(8, r.bottom + 6));
    setPos({ left, top, width, up });
  }, [open, shown.length]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    const close = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => !list.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQ('');
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || (e.key === ' ' && !search)) {
      if (!open) return;
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(shown.length - 1);
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`vselect${open ? ' open' : ''}${className ? ' ' + className : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? title}
        title={title}
        disabled={disabled}
      >
        {current?.icon}
        <span className={`vselect-value${current ? '' : ' muted'}`}>{current?.label ?? placeholder}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            className={`vselect-pop${pos.up ? ' up' : ''}`}
            style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
            onKeyDown={onKey}
          >
            {search && (
              <input
                autoFocus
                className="vselect-search"
                placeholder="Search…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
              />
            )}
            <div className="vselect-list" role="listbox">
              {shown.length === 0 && <div className="vselect-empty">No matches</div>}
              {shown.map((o, i) => {
                const header = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.value + i}>
                    {header && <div className="vselect-group">{header}</div>}
                    <div
                      data-i={i}
                      role="option"
                      aria-selected={o.value === value}
                      aria-disabled={o.disabled}
                      className={`vselect-opt${i === active ? ' active' : ''}${o.value === value ? ' selected' : ''}${o.disabled ? ' disabled' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      {o.icon}
                      <span className="grow">{o.label}</span>
                      {o.hint && <span className="small muted">{o.hint}</span>}
                      {o.value === value && <Icon name="check" size={14} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
