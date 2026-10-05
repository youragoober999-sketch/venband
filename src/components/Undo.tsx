// "Moved #general · Undo" — a small toast after reversible changes.
import { useEffect } from 'react';
import { createStore } from '../lib/store';
import { Icon } from './ui';

const store = createStore<{ item: { id: number; text: string; undo: () => Promise<void> | void } | null }>({ item: null });
let n = 0;

export function showUndo(text: string, undo: () => Promise<void> | void) {
  store.set({ item: { id: ++n, text, undo } });
}

export function UndoToast() {
  const item = store.use((s) => s.item);
  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => store.get().item?.id === item.id && store.set({ item: null }), 8000);
    return () => clearTimeout(t);
  }, [item]);
  if (!item) return null;
  return (
    <div className="undo-toast" role="status">
      <Icon name="check" size={16} />
      <span>{item.text}</span>
      <button
        className="btn small secondary"
        onClick={async () => {
          store.set({ item: null });
          await item.undo();
        }}
      >
        Undo
      </button>
      <button className="icon-btn small" onClick={() => store.set({ item: null })} aria-label="Dismiss">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
