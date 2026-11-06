// In-app dialogs: messages, confirmations and text prompts. Venband never shows
// the browser's own alert / confirm / prompt boxes ("www.venband.com says…") —
// main.tsx even routes a stray window.alert() here.
// Dialogs queue: a second one waits until the first is answered (it used to
// replace it, leaving the first caller waiting forever).
import { useState } from 'react';
import { createStore } from '../lib/store';
import { Field, Modal } from './ui';

type Ask =
  | { kind: 'text'; title: string; label: string; initial: string; placeholder?: string; maxLength?: number; hint?: string; confirm?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'alert'; title: string; body: string; resolve: () => void };

const store = createStore<{ queue: Ask[] }>({ queue: [] });
const push = (a: Ask) => store.set((s) => ({ queue: [...s.queue, a] }));
const pop = () => store.set((s) => ({ queue: s.queue.slice(1) }));

export function askText(opts: { title: string; label: string; initial?: string; placeholder?: string; maxLength?: number; hint?: string; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'text', initial: '', ...opts, resolve }));
}

export function askConfirm(opts: { title: string; body: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', confirm: 'Confirm', ...opts, resolve }));
}

/** A message with an OK button (replaces window.alert). */
export function showAlert(body: string, title = 'Venband'): Promise<void> {
  return new Promise((resolve) => push({ kind: 'alert', title, body, resolve }));
}

export function DialogHost() {
  const ask = store.use((s) => s.queue[0]);
  if (!ask) return null;
  if (ask.kind === 'text') return <TextDialog key={ask.title + ask.label} ask={ask} />;
  if (ask.kind === 'alert') return <AlertDialog ask={ask} />;
  return <ConfirmDialog ask={ask} />;
}

function TextDialog({ ask }: { ask: Extract<Ask, { kind: 'text' }> }) {
  const [value, setValue] = useState(ask.initial);
  const done = (v: string | null) => {
    pop();
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
          <button className="btn primary">{ask.confirm ?? 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ ask }: { ask: Extract<Ask, { kind: 'confirm' }> }) {
  const done = (v: boolean) => {
    pop();
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

function AlertDialog({ ask }: { ask: Extract<Ask, { kind: 'alert' }> }) {
  const done = () => {
    pop();
    ask.resolve();
  };
  return (
    <Modal title={ask.title} onClose={done}>
      <p className="dialog-message">{ask.body}</p>
      <div className="modal-actions">
        <button className="btn primary" onClick={done} autoFocus>
          OK
        </button>
      </div>
    </Modal>
  );
}
