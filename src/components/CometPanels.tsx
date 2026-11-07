// Comet's set-up panels (opened by commands like /wordlogger).
import { useState } from 'react';
import { Icon, Modal } from './ui';

/** /wordlogger: pick a log channel and the words to watch for. */
export function WordLoggerPanel({
  channels,
  onClose,
  onSave,
  onOff,
}: {
  channels: { id: string; label: string }[];
  onClose: () => void;
  onSave: (channelId: string, words: string[]) => Promise<void>;
  onOff: () => Promise<void>;
}) {
  const [chan, setChan] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = [...new Set(raw.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  const shown = channels.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase().replace(/^#/, '')));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Word logger" onClose={onClose} className="comet-modal">
      <div className="comet-head">
        <span className="comet-badge">☄️</span>
        <p>
          When someone uses one of these words, Comet posts it (hidden behind a spoiler) in the channel you pick. Each person’s own device checks their
          message before it’s encrypted.
        </p>
      </div>
      <div className="comet-step">
        <span className="comet-step-n">1</span> Log channel
      </div>
      <div className="comet-search">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a channel" autoFocus />
      </div>
      <div className="comet-chans" role="listbox" aria-label="Channels">
        {shown.map((c) => (
          <button key={c.id} role="option" aria-selected={chan === c.id} className={chan === c.id ? 'on' : ''} onClick={() => setChan(c.id)}>
            <span className="comet-hash">#</span> {c.label}
            {chan === c.id && <Icon name="check" size={15} />}
          </button>
        ))}
        {!shown.length && <p className="muted small">No channel matches.</p>}
      </div>
      <div className="comet-step">
        <span className="comet-step-n">2</span> Words to log
      </div>
      <textarea className="comet-words" rows={2} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="word1, word2, word 3" />
      {words.length > 0 && (
        <div className="comet-chips">
          {words.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn link danger-text" disabled={busy} onClick={() => run(onOff)}>
          Turn off
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !chan || !words.length} onClick={() => run(() => onSave(chan!, words))}>
          {busy ? 'Saving…' : `Log ${words.length || ''} word${words.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
