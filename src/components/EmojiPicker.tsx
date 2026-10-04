// Full emoji picker: search, frequently used, categories, server emoji.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EMOJI_GROUPS, emojiList, frequentEmoji, loadEmoji, searchEmoji, type CustomEmoji, type EmojiEntry } from '../lib/emoji';
import { Icon } from './ui';

export type PickedEmoji = { kind: 'unicode'; char: string } | { kind: 'custom'; emoji: CustomEmoji };

export function EmojiPicker({
  onPick,
  onClose,
  anchor,
  custom = [],
  title = 'Emoji',
}: {
  onPick: (e: PickedEmoji) => void;
  onClose: () => void;
  /** element to position next to (the picker is portalled to <body>) */
  anchor: HTMLElement | null;
  custom?: CustomEmoji[];
  title?: string;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<EmojiEntry[]>(emojiList());
  const [hover, setHover] = useState<{ char?: string; url?: string; name: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEmoji().then(setList);
  }, []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    const h = Math.min(420, window.innerHeight - 16);
    let left = r.right - w;
    if (left < 8) left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [anchor]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  const results = useMemo(() => (q.trim() ? searchEmoji(q, custom, 80) : null), [q, custom, list]);
  const frequent = frequentEmoji(16);
  const groups = useMemo(() => EMOJI_GROUPS.map((g) => ({ ...g, items: list.filter((e) => e.group === g.id) })), [list]);

  const pickChar = (char: string) => onPick({ kind: 'unicode', char });
  const jump = (id: string) => body.current?.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: 'start' });

  return createPortal(
    <div ref={ref} className="emoji-picker" role="dialog" aria-label={title} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      <div className="emoji-picker-head">
        <input
          autoFocus
          placeholder="Search emoji (heart, fire, :joy:)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) {
              e.preventDefault();
              const r = results[0];
              onPick(r.kind === 'unicode' ? { kind: 'unicode', char: r.char } : { kind: 'custom', emoji: r.emoji });
            }
          }}
        />
      </div>
      {!results && (
        <div className="emoji-tabs" role="tablist">
          {frequent.length > 0 && (
            <button title="Frequently used" onClick={() => jump('frequent')}>
              <Icon name="clock" size={16} />
            </button>
          )}
          {custom.length > 0 && (
            <button title="Server emoji" onClick={() => jump('custom')}>
              <Icon name="star" size={16} />
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button key={g.id} title={g.label} onClick={() => jump(String(g.id))}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-body" ref={body}>
        {results ? (
          results.length ? (
            <div className="emoji-grid">
              {results.map((r) =>
                r.kind === 'unicode' ? (
                  <button key={r.char} title={`:${r.name}:`} onClick={() => pickChar(r.char)} onMouseEnter={() => setHover({ char: r.char, name: r.name })}>
                    {r.char}
                  </button>
                ) : (
                  <button key={r.emoji.id} title={`:${r.emoji.name}:`} onClick={() => onPick({ kind: 'custom', emoji: r.emoji })} onMouseEnter={() => setHover({ url: r.emoji.url, name: r.emoji.name })}>
                    <img src={r.emoji.url} alt={`:${r.emoji.name}:`} />
                  </button>
                ),
              )}
            </div>
          ) : (
            <div className="emoji-empty">No emoji match “{q}”.</div>
          )
        ) : (
          <>
            {frequent.length > 0 && (
              <section data-group="frequent">
                <h4>Frequently used</h4>
                <div className="emoji-grid">
                  {frequent.map((c) => (
                    <button key={c} onClick={() => pickChar(c)} onMouseEnter={() => setHover({ char: c, name: list.find((e) => e.char === c)?.names[0] ?? '' })}>
                      {c}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {custom.length > 0 && (
              <section data-group="custom">
                <h4>Server emoji</h4>
                <div className="emoji-grid">
                  {custom.map((c) => (
                    <button key={c.id} title={`:${c.name}:${c.serverName ? ` · ${c.serverName}` : ''}`} onClick={() => onPick({ kind: 'custom', emoji: c })} onMouseEnter={() => setHover({ url: c.url, name: c.name })}>
                      <img src={c.url} alt={`:${c.name}:`} loading="lazy" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <section key={g.id} data-group={g.id}>
                    <h4>{g.label}</h4>
                    <div className="emoji-grid">
                      {g.items.map((e) => (
                        <button key={e.char} onClick={() => pickChar(e.char)} onMouseEnter={() => setHover({ char: e.char, name: e.names[0] })}>
                          {e.char}
                        </button>
                      ))}
                    </div>
                  </section>
                ),
            )}
          </>
        )}
      </div>
      <div className="emoji-foot">
        {hover ? (
          <>
            <span className="emoji-foot-big">{hover.url ? <img src={hover.url} alt="" /> : hover.char}</span>
            <span className="mono small">:{hover.name}:</span>
          </>
        ) : (
          <span className="small muted">Tip: type :name in a message, like :heart</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
