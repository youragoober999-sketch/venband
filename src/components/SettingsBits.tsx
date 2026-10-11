// Building blocks shared by every settings page.
import type { ReactNode } from 'react';

export function Section({ title, children, desc, id }: { title: string; desc?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="settings-section" id={id}>
      <h3>{title}</h3>
      {desc && <p className="muted small">{desc}</p>}
      {children}
    </section>
  );
}

export function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {desc && <span className="small muted">{desc}</span>}
      </span>
      <input type="checkbox" className="toggle-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** A labelled 0-100 (or any range) slider whose filled track always matches the value. */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider-row">
      <span className="slider-label">
        <b>{label}</b>
        <span className="small muted">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
