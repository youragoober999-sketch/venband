// Promise-based text prompt / confirm dialogs (instead of window.prompt).
import { useState } from 'react';
import { createStore } from '../lib/store';
import { Field, Modal } from './ui';

type Ask =
  | { kind: 'text'; title: string; label: string; initial: string; placeholder?: string; maxLength?: number; hint?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void };

const store = createStore<{ ask: Ask | null }>({ ask: null });

export function askText(opts: { title: string; label: string; initial?: string; placeholder?: string; maxLength?: number; hint?: string }): Promise<string | null> {
  return new Promise((resolve) => store.set({ ask: { kind: 'text', initial: '', ...opts, resolve } }));
}

export function askConfirm(opts: { title: string; body: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => store.set({ ask: { kind: 'confirm', confirm: 'Confirm', ...opts, resolve } }));
}

export function DialogHost() {
  const ask = store.use((s) => s.ask);
  if (!ask) return null;
  return ask.kind === 'text' ? <TextDialog key={ask.title} ask={ask} /> : <ConfirmDialog ask={ask} />;
}

function TextDialog({ ask }: { ask: Extract<Ask, { kind: 'text' }> }) {
  const [value, setValue] = useState(ask.initial);
  const done = (v: string | null) => {
    store.set({ ask: null });
    ask.resolve(v);
  };
  return (
    <Modal title={ask.title} onClose={() => done(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(value);
        }}
      >
        <Field label={ask.label} hint={ask.hint}>
          <input autoFocus value={value} maxLength={ask.maxLength ?? 100} placeholder={ask.placeholder} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ ask }: { ask: Extract<Ask, { kind: 'confirm' }> }) {
  const done = (v: boolean) => {
    store.set({ ask: null });
    ask.resolve(v);
  };
  return (
    <Modal title={ask.title} onClose={() => done(false)}>
      <p className="muted">{ask.body}</p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={() => done(false)}>
          Cancel
        </button>
        <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>
          {ask.confirm}
        </button>
      </div>
    </Modal>
  );
}
