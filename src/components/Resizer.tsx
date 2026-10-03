import { useRef } from 'react';

/**
 * Drag handle that resizes a neighbouring panel. `axis="x"` with `invert`
 * means dragging left makes the panel bigger (panels on the right side).
 */
export function Resizer({
  axis,
  value,
  min,
  max,
  invert,
  onChange,
}: {
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (v: number) => void;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  return (
    <div
      className={`resizer ${axis}${invert ? ' invert' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { pos: axis === 'x' ? e.clientX : e.clientY, value };
        document.body.classList.add('resizing', axis === 'x' ? 'resizing-x' : 'resizing-y');
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = (axis === 'x' ? e.clientX : e.clientY) - start.current.pos;
        onChange(clamp(start.current.value + (invert ? -delta : delta)));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
      }}
      onDoubleClick={() => onChange(clamp(axis === 'x' ? 248 : 320))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const dir = axis === 'x' ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (dir) onChange(clamp(value + dir * step * (invert ? -1 : 1)));
      }}
    />
  );
}
