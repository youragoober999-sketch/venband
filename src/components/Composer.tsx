// The message box: mentions, :emoji: autocomplete, formatting, files (with
// spoilers and alt text), drafts, spell check, polls, scheduled sending.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { MAX_FILE } from '../lib/files';
import { socialStore } from '../lib/social';
import { getSettings, noteEmojiUse, useSettings } from '../lib/settings';
import { emojiIn, loadEmoji, replaceShortcodes, searchEmoji, type CustomEmoji, type EmojiMatch } from '../lib/emoji';
import { addToDictionary, autoFix, findMistakes, suggestions as spellSuggestions } from '../lib/spell';
import type { Profile } from '../lib/types';
import { formatSize } from './Attachments';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';
import { openMenu, openMenuAt, type Entry } from './ContextMenu';
import { askText } from './Dialogs';
import { Avatar, Field, Icon, Modal } from './ui';
import { Select } from './Select';

export const MAX_TEXT = 2000;
const HARD_MAX = 200_000; // longer messages go out as a .txt file

export interface Mentionables {
  people: { id: string; label: string; sub: string; profile: Profile }[];
  roles: { id: string; label: string; color: string }[];
  channels: { id: string; label: string }[];
  everyone: boolean;
  emoji?: CustomEmoji[];
  /** slash commands from the server's bots */
  commands?: { app_id: string; app_name: string; name: string; description: string }[];
}

export interface PendingFile {
  id: string;
  file: File;
  spoiler: boolean;
  alt: string;
}

export interface PollDraft {
  question: string;
  options: string[];
  multi: boolean;
  anonymous: boolean;
  hours: number | null;
}

export interface SendOptions {
  onProgress?: (fraction: number) => void;
  poll?: PollDraft;
  /** deliver later (ms since epoch); repeat creates several scheduled copies */
  scheduleAt?: number;
  repeat?: { every: 'day' | 'week'; times: number };
}

type Suggestion = { key: string; insert: string; token: string | null; label: ReactNode; sub?: string; emoji?: string };

const draftKey = (channelId: string) => `venband:draft:${sessionStore.get().identity?.userId ?? 'anon'}:${channelId}`;

export function Composer({
  channelId,
  placeholder,
  disabled,
  replyTo,
  quote,
  onCancelReply,
  onCancelQuote,
  onSend,
  mentionables,
  incoming,
  onIncomingTaken,
  canSchedule = true,
  canRepeat = false,
  canPoll = true,
  canAttach = true,
  onQuoteDrop,
}: {
  channelId: string;
  placeholder: string;
  disabled: boolean;
  replyTo: string | null;
  quote?: { author: string; text: string } | null;
  onCancelReply: () => void;
  onCancelQuote?: () => void;
  onSend: (text: string, files: PendingFile[], opts: SendOptions) => Promise<void>;
  mentionables: Mentionables;
  /** files dropped onto the chat */
  incoming: File[];
  onIncomingTaken: () => void;
  canSchedule?: boolean;
  canRepeat?: boolean;
  canPoll?: boolean;
  canAttach?: boolean;
  /** a message was dragged onto the box */
  onQuoteDrop?: (messageId: string) => void;
}) {
  const chat = useSettings((s) => s.chat);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gifs, setGifs] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<{ start: number; end: number; word: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const mdBackdrop = useRef<HTMLDivElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const lastTyping = useRef(0);
  const tokens = useRef(new Map<string, string>());
  const pendingCaret = useRef<number | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [fmt, setFmt] = useState<{ x: number; y: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const sendTyping = useTypingSender(channelId);

  useEffect(() => {
    loadEmoji();
  }, []);

  // drafts: restore when switching conversations, save as you type
  useEffect(() => {
    let saved = '';
    if (getSettings().chat.saveDrafts) {
      try {
        saved = localStorage.getItem(draftKey(channelId)) ?? '';
      } catch {
        /* ignore */
      }
    }
    setText(saved);
    setFiles([]);
    setError(null);
    setNotice(null);
    tokens.current = new Map();
  }, [channelId]);
  useEffect(() => {
    if (!chat.saveDrafts) return;
    const t = setTimeout(() => {
      try {
        if (text.trim()) localStorage.setItem(draftKey(channelId), text);
        else localStorage.removeItem(draftKey(channelId));
      } catch {
        /* storage full or blocked */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text, channelId, chat.saveDrafts]);

  // spell check underlines
  useEffect(() => {
    if (chat.autocorrect === 'off' || !text) return setMistakes([]);
    let cancelled = false;
    const t = setTimeout(() => findMistakes(text).then((m) => !cancelled && setMistakes(m)), 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, chat.autocorrect]);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    if (pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
    if (pendingSelection.current) {
      el.focus();
      el.setSelectionRange(...pendingSelection.current);
      pendingSelection.current = null;
      requestAnimationFrame(updateFmt);
    }
  }, [text]);

  const query = useMemo(() => {
    const before = text.slice(0, caret);
    const slash = before.match(/^\/([a-z0-9_-]{0,32})$/i);
    if (slash && mentionables.commands?.length) return { trigger: '/', q: slash[1].toLowerCase(), start: 0 };
    const m = before.match(/(^|\s)([@#])([^\s@#]{0,32})$/);
    if (m) return { trigger: m[2], q: m[3].toLowerCase(), start: caret - m[3].length - 1 };
    const e = before.match(/(^|[\s(])(:)([a-z0-9_+-]{2,32})$/i);
    if (e) return { trigger: ':', q: e[3].toLowerCase(), start: caret - e[3].length - 1 };
    return null;
  }, [text, caret]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!query || dismissed === `${query.start}:${query.trigger}`) return [];
    if (query.trigger === ':') {
      return searchEmoji(query.q, mentionables.emoji ?? [], 9).map((m: EmojiMatch) =>
        m.kind === 'unicode'
          ? { key: m.char, insert: m.char, token: null, emoji: m.char, label: <><span className="sugg-emoji">{m.char}</span> :{m.name}:</> }
          : {
              key: m.emoji.id,
              insert: `:${m.emoji.name}:`,
              token: `<${m.emoji.animated ? 'a' : ''}:${m.emoji.name}:${m.emoji.id}>`,
              emoji: `custom:${m.emoji.id}`,
              label: <><img className="sugg-emoji" src={m.emoji.url} alt="" /> :{m.emoji.name}:</>,
              sub: m.emoji.serverName,
            },
      );
    }
    if (query.trigger === '/')
      return (mentionables.commands ?? [])
        .filter((c) => c.name.startsWith(query.q))
        .slice(0, 8)
        .map((c) => ({ key: `${c.app_id}:${c.name}`, insert: `/${c.name}`, token: null, label: <><span className="sugg-slash">/</span>{c.name}</>, sub: `${c.description ? `${c.description} · ` : ''}${c.app_name}` }));
    if (query.trigger === '#')
      return mentionables.channels
        .filter((c) => c.label.toLowerCase().includes(query.q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, insert: `#${c.label}`, token: `<#${c.id}>`, label: <># {c.label}</> }));
    const out: Suggestion[] = mentionables.people
      .filter((p) => p.label.toLowerCase().includes(query.q) || p.sub.includes(query.q))
      .filter((p) => !socialStore.get().relations[p.id]?.blocked)
      .slice(0, 8)
      .map((p) => ({ key: p.id, insert: `@${p.label}`, token: `<@${p.id}>`, label: <><Avatar profile={p.profile} size={22} /> {p.label}</>, sub: p.sub }));
    for (const r of mentionables.roles.filter((r) => r.label.toLowerCase().includes(query.q)).slice(0, 5))
      out.push({ key: r.id, insert: `@${r.label}`, token: `<@&${r.id}>`, label: <span style={{ color: r.color }}>@{r.label}</span>, sub: 'role' });
    if (mentionables.everyone)
      for (const w of ['everyone', 'here'])
        if (w.startsWith(query.q))
          out.push({ key: w, insert: `@${w}`, token: `@${w}`, label: `@${w}`, sub: w === 'everyone' ? 'Notify everyone in this channel' : 'Notify everyone online' });
    return out;
  }, [query, mentionables, dismissed]);

  useEffect(() => setSel(0), [query?.q, query?.trigger]);

  function updateFmt() {
    const el = textarea.current;
    const wrap = el?.closest('.composer-wrap') as HTMLElement | null;
    if (!el || !wrap || el.selectionStart === el.selectionEnd || document.activeElement !== el) return setFmt(null);
    const at = caretCoords(el, el.selectionStart);
    const end = caretCoords(el, el.selectionEnd);
    const box = el.getBoundingClientRect();
    const wbox = wrap.getBoundingClientRect();
    const x = box.left - wbox.left + (at.top === end.top ? (at.left + end.left) / 2 : at.left);
    setFmt({ x: Math.max(150, Math.min(wbox.width - 150, x)), y: box.top - wbox.top + at.top - 6 });
  }

  function applyFormat(kind: 'wrap' | 'line', marker: string) {
    const el = textarea.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if (kind === 'wrap') {
      const s = text.slice(a, b);
      if (text.slice(a - marker.length, a) === marker && text.slice(b, b + marker.length) === marker) {
        setText(text.slice(0, a - marker.length) + s + text.slice(b + marker.length));
        pendingSelection.current = [a - marker.length, b - marker.length];
        return;
      }
      setText(text.slice(0, a) + marker + s + marker + text.slice(b));
      pendingSelection.current = [a + marker.length, b + marker.length];
      return;
    }
    const lineStart = text.lastIndexOf('\n', a - 1) + 1;
    const nextBreak = text.indexOf('\n', b);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const prefix = marker + ' ';
    const allHave = lines.every((l) => l.startsWith(prefix));
    const next = lines.map((l) => {
      const bare = l.replace(/^(#{1,3}|-#|>|-) /, '');
      return allHave ? bare : prefix + bare;
    });
    const joined = next.join('\n');
    setText(text.slice(0, lineStart) + joined + text.slice(lineEnd));
    pendingSelection.current = [lineStart, lineStart + joined.length];
  }

  function wrapBlock() {
    const el = textarea.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const s = text.slice(a, b);
    setText(`${text.slice(0, a)}\`\`\`\n${s}\n\`\`\`${text.slice(b)}`);
    pendingSelection.current = [a + 4, a + 4 + s.length];
  }

  function pick(s: Suggestion) {
    if (!query) return;
    const before = text.slice(0, query.start);
    const after = text.slice(caret);
    const next = `${before}${s.insert}${after.startsWith(' ') ? '' : ' '}${after}`;
    if (s.token) tokens.current.set(s.insert, s.token);
    if (s.emoji) noteEmojiUse(s.emoji);
    pendingCaret.current = before.length + s.insert.length + 1;
    setText(next);
  }

  function insertAtCaret(insert: string) {
    const el = textarea.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    pendingCaret.current = at + insert.length;
    setText((t) => t.slice(0, at) + insert + t.slice(end));
  }

  function encode(t: string): string {
    let out = t;
    for (const [shown, token] of [...tokens.current.entries()].sort((a, b) => b[0].length - a[0].length)) out = out.split(shown).join(token);
    out = out.replace(/(^|\s)@([a-z0-9_.]{2,32})\b/g, (all, pre: string, u: string) => {
      const p = mentionables.people.find((x) => x.sub === u);
      return p ? `${pre}<@${p.id}>` : all;
    });
    return replaceShortcodes(out, mentionables.emoji ?? []);
  }

  async function submit(raw = text, extra: PendingFile[] = [], opts: Omit<SendOptions, 'onProgress'> = {}) {
    let t = encode(raw.trim());
    let all = [...files, ...extra];
    if ((!t && !all.length && !opts.poll) || busy) return;
    // long messages go out as a text file instead of a wall of text
    if (t.length > MAX_TEXT) {
      if (!chat.longTextAsFile) return setError(`Messages can be up to ${MAX_TEXT.toLocaleString()} characters. Turn on “Send long messages as a file” in Settings → Chat, or shorten it.`);
      all = [{ id: crypto.randomUUID(), file: new File([t], 'message.txt', { type: 'text/plain' }), spoiler: false, alt: '' }, ...all];
      t = '';
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setUpload(all.length ? 0 : null);
      await onSend(t, all, { ...opts, onProgress: all.length ? setUpload : undefined });
      for (const e of emojiIn(t)) noteEmojiUse(e);
      if (opts.scheduleAt) setNotice(`Scheduled for ${new Date(opts.scheduleAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${opts.repeat ? `, repeating every ${opts.repeat.every} (${opts.repeat.times}×)` : ''}.`);
      if (raw === text) {
        setText('');
        setFiles([]);
        tokens.current = new Map();
        try {
          localStorage.removeItem(draftKey(channelId));
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setUpload(null);
    }
  }

  function addFiles(picked: File[]) {
    const tooBig = picked.find((f) => f.size > MAX_FILE);
    if (tooBig) setError(`${tooBig.name} is larger than 5 GB.`);
    const ok = picked.filter((x) => x.size <= MAX_FILE).map((file) => ({ id: crypto.randomUUID(), file, spoiler: false, alt: '' }));
    setFiles((f) => [...f, ...ok].slice(0, 10));
  }

  useEffect(() => {
    if (!incoming.length) return;
    addFiles(incoming);
    onIncomingTaken();
    textarea.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  async function onTextContext(e: React.MouseEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    // the word under the caret / selection
    let start = a;
    let end = b;
    if (a === b) {
      while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--;
      while (end < text.length && /[A-Za-z']/.test(text[end])) end++;
    }
    const word = text.slice(start, end).trim();
    const native = e.nativeEvent;
    e.preventDefault();
    const wrong = mistakes.find((m) => m.start <= start && m.end >= end) || (word && /^[A-Za-z']+$/.test(word) && a !== b);
    const sugg = wrong && word ? await spellSuggestions(word) : [];
    const replaceWith = (w: string) => {
      setText(text.slice(0, start) + w + text.slice(end));
      pendingCaret.current = start + w.length;
    };
    const items: Entry[] = [
      wrong && { type: 'header', label: <span><Icon name="spellcheck" size={13} /> {sugg.length ? 'Did you mean' : 'No suggestions'}</span> },
      ...sugg.map((w) => ({ label: w, onClick: () => replaceWith(w) })),
      wrong && word && { label: `Add “${word}” to dictionary`, icon: 'bookmark', onClick: () => (addToDictionary(word), setMistakes((m) => m.filter((x) => x.word !== word))) },
      wrong && { type: 'sep' },
      a !== b && { label: 'Cut', icon: 'scissors', onClick: () => (el.focus(), document.execCommand('cut')) },
      a !== b && { label: 'Copy', icon: 'copy', onClick: () => (el.focus(), document.execCommand('copy')) },
      { label: 'Paste', icon: 'clipboard', onClick: () => navigator.clipboard?.readText().then((t) => insertAtCaret(t)).catch(() => {}) },
      a !== b && { type: 'sep' },
      a !== b && { label: 'Bold', hint: 'Ctrl+B', onClick: () => applyFormat('wrap', '**') },
      a !== b && { label: 'Italic', hint: 'Ctrl+I', onClick: () => applyFormat('wrap', '*') },
      a !== b && { label: 'Strikethrough', hint: 'Ctrl+Shift+S', onClick: () => applyFormat('wrap', '~~') },
      a !== b && { label: 'Spoiler', onClick: () => applyFormat('wrap', '||') },
      a !== b && { label: 'Code block', onClick: wrapBlock },
    ];
    openMenu(native, items);
  }

  const showAutocorrectLine = chat.autocorrect !== 'off' && mistakes.length > 0;

  return (
    <div
      className="composer-wrap"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('application/x-venband-message')) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-venband-message');
        if (id && onQuoteDrop) {
          e.preventDefault();
          e.stopPropagation();
          onQuoteDrop(id);
          textarea.current?.focus();
        }
      }}
    >
      {replyTo && (
        <div className="replying">
          <span>
            <Icon name="reply" size={13} /> Replying to <b>{replyTo}</b>
          </span>
          <button className="icon-btn" onClick={onCancelReply} aria-label="Cancel reply">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {quote && (
        <div className="replying quoting">
          <span className="ellipsis">
            <Icon name="quote" size={13} /> Quoting <b>{quote.author}</b>: {quote.text.slice(0, 120)}
          </span>
          <button className="icon-btn" onClick={onCancelQuote} aria-label="Remove quote">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files" role="list" aria-label="Files to send">
          {files.map((f, i) => (
            <PendingFileCard
              key={f.id}
              f={f}
              first={i === 0}
              last={i === files.length - 1}
              onChange={(nf) => setFiles((all) => all.map((x) => (x.id === f.id ? nf : x)))}
              onRemove={() => setFiles((all) => all.filter((x) => x.id !== f.id))}
              onMove={(d) =>
                setFiles((all) => {
                  const next = [...all];
                  const j = i + d;
                  [next[i], next[j]] = [next[j], next[i]];
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
      {upload !== null && (
        <div className="upload-progress" role="status">
          <span>Encrypting and uploading… {Math.round(upload * 100)}%</span>
          <div className="att-progress">
            <span style={{ width: `${Math.round(upload * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && (
        <div className="form-notice" role="status">
          <Icon name="clock" size={14} /> {notice}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mention-pop" role="listbox">
          <div className="mention-pop-title">{query?.trigger === ':' ? `Emoji matching :${query.q}` : query?.trigger === '#' ? 'Channels' : query?.trigger === '/' ? 'Commands' : 'Members & roles'}</div>
          {suggestions.map((s, i) => (
            <button
              key={s.key}
              role="option"
              aria-selected={i === sel}
              className={`mention-option${i === sel ? ' active' : ''}`}
              onMouseDown={(e) => (e.preventDefault(), pick(s))}
              onMouseEnter={() => setSel(i)}
            >
              <span className="mention-label">{s.label}</span>
              {s.sub && <span className="small muted">{s.sub}</span>}
              {i === 0 && <kbd className="small">Enter</kbd>}
            </button>
          ))}
        </div>
      )}
      {gifs && <GifPicker onClose={() => setGifs(false)} onPick={(url) => submit(url)} onFile={(f) => submit('', [{ id: crypto.randomUUID(), file: f, spoiler: false, alt: '' }])} />}
      {fmt && !disabled && (
        <div className="fmt-bar" style={{ left: fmt.x, top: fmt.y }} onMouseDown={(e) => e.preventDefault()} role="toolbar" aria-label="Formatting">
          <button title="Bold (Ctrl+B)" onClick={() => applyFormat('wrap', '**')}><b>B</b></button>
          <button title="Italic (Ctrl+I)" onClick={() => applyFormat('wrap', '*')}><i>I</i></button>
          <button title="Underline (Ctrl+U)" onClick={() => applyFormat('wrap', '__')}><u>U</u></button>
          <button title="Strikethrough (Ctrl+Shift+S)" onClick={() => applyFormat('wrap', '~~')}><s>S</s></button>
          <button title="Inline code (Ctrl+E)" className="mono" onClick={() => applyFormat('wrap', '`')}>{'</>'}</button>
          <button title="Code block" className="mono" onClick={wrapBlock}>{'{ }'}</button>
          <button title="Spoiler" onClick={() => applyFormat('wrap', '||')}><Icon name="eyeOff" size={14} /></button>
          <span className="fmt-sep" />
          <button title="Quote" onClick={() => applyFormat('line', '>')}><Icon name="quote" size={14} /></button>
          <button title="List" onClick={() => applyFormat('line', '-')}>•</button>
          <button title="Big heading" onClick={() => applyFormat('line', '#')}>H1</button>
          <button title="Medium heading" onClick={() => applyFormat('line', '##')}>H2</button>
          <button title="Small heading" onClick={() => applyFormat('line', '###')}>H3</button>
          <button title="Small grey text" onClick={() => applyFormat('line', '-#')}><small>-#</small></button>
        </div>
      )}
      <div className={`composer${disabled ? ' disabled' : ''}`}>
        <button
          className="icon-btn"
          disabled={disabled}
          onClick={(e) =>
            openMenuAt(e.currentTarget, [
              canAttach && { label: 'Upload a file', icon: 'upload', hint: 'up to 5 GB', onClick: () => fileInput.current?.click() },
              canPoll && { label: 'Create a poll', icon: 'poll', onClick: () => setPollOpen(true) },
              canSchedule && { label: 'Schedule a message', icon: 'clock', onClick: () => setScheduleOpen(true) },
            ])
          }
          title="Upload, poll or schedule"
          aria-label="Upload, poll or schedule"
        >
          <Icon name="plus" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <div className={`composer-input${composing ? ' composing' : ''}`}>
          <div className="md-backdrop" ref={mdBackdrop} aria-hidden>
            {renderPreview(text)}
          </div>
          {showAutocorrectLine && (
            <div className="spell-backdrop" ref={backdrop} aria-hidden>
              {renderMistakes(text, mistakes)}
            </div>
          )}
          <textarea
            ref={textarea}
            rows={1}
            value={text}
            maxLength={HARD_MAX}
            disabled={disabled || busy}
            placeholder={placeholder}
            spellCheck={false}
            aria-label={placeholder}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              if (Date.now() - lastTyping.current > 3000) {
                lastTyping.current = Date.now();
                sendTyping();
              }
            }}
            onScroll={(e) => {
              setFmt(null);
              if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
              if (mdBackdrop.current) mdBackdrop.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onSelect={(e) => {
              setCaret(e.currentTarget.selectionStart ?? 0);
              updateFmt();
            }}
            onBlur={() => setTimeout(() => document.activeElement !== textarea.current && setFmt(null), 150)}
            onContextMenu={onTextContext}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted.map((f, i) => (f.name === 'image.png' ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f)));
              }
            }}
            onKeyDown={async (e) => {
              if (suggestions.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pick(suggestions[sel]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  if (query) setDismissed(`${query.start}:${query.trigger}`);
                  return;
                }
              }
              const mod = e.ctrlKey || e.metaKey;
              const hasSel = e.currentTarget.selectionStart !== e.currentTarget.selectionEnd;
              if (mod && hasSel && !e.shiftKey && ['b', 'i', 'u', 'e'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                applyFormat('wrap', { b: '**', i: '*', u: '__', e: '`' }[e.key.toLowerCase() as 'b' | 'i' | 'u' | 'e']);
                return;
              }
              if (mod && hasSel && e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                applyFormat('wrap', '~~');
                return;
              }
              // hands-free autocorrect: fix the word you just finished
              if (chat.autocorrect === 'auto' && (e.key === ' ' || e.key === 'Enter' || /^[.,!?]$/.test(e.key))) {
                const el = e.currentTarget;
                const at = el.selectionStart;
                const m = text.slice(0, at).match(/([A-Za-z']+)$/);
                if (m && at === el.selectionEnd) {
                  const fix = await autoFix(m[1]);
                  if (fix && fix !== m[1]) {
                    const start = at - m[1].length;
                    setText((t) => t.slice(0, start) + fix + t.slice(at));
                    pendingCaret.current = start + fix.length;
                  }
                }
              }
              const isSendKey = e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (chat.enterToSend ? !mod : mod);
              if (isSendKey) {
                e.preventDefault();
                setFmt(null);
                submit();
              }
            }}
          />
        </div>
        {busy ? (
          <div className="spinner small" />
        ) : (
          <>
            <button type="button" className="icon-btn gif-btn" disabled={disabled} onClick={() => setGifs((g) => !g)} title="GIFs" aria-label="GIFs">
              <Icon name="gif" />
            </button>
            <button ref={emojiBtn} type="button" className="icon-btn" disabled={disabled} onClick={() => setEmojiOpen((o) => !o)} title="Emoji" aria-label="Emoji">
              <Icon name="smile" />
            </button>
            <button
              type="button"
              className={`icon-btn send-btn${text.trim() || files.length ? ' ready' : ''}`}
              disabled={disabled || (!text.trim() && !files.length)}
              onClick={() => submit()}
              onContextMenu={(e) =>
                canSchedule &&
                openMenu(e, [
                  { type: 'header', label: 'Send later' },
                  { label: 'In 1 hour', icon: 'clock', onClick: () => submit(text, [], { scheduleAt: Date.now() + 3_600_000 }) },
                  { label: 'Tonight at 8 PM', icon: 'clock', onClick: () => submit(text, [], { scheduleAt: atHour(20) }) },
                  { label: 'Tomorrow at 9 AM', icon: 'clock', onClick: () => submit(text, [], { scheduleAt: atHour(9, 1) }) },
                  { label: 'Pick a date & time…', icon: 'calendar', onClick: () => setScheduleOpen(true) },
                ])
              }
              title="Send (Enter) · right-click to send later"
              aria-label="Send"
            >
              <Icon name="send" size={18} />
            </button>
          </>
        )}
      </div>
      {text.length > MAX_TEXT * 0.9 && (
        <div className={`char-count${text.length > MAX_TEXT ? ' over' : ''}`}>
          {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}
          {text.length > MAX_TEXT && (chat.longTextAsFile ? ' · will be sent as message.txt' : ' · too long')}
        </div>
      )}
      {emojiOpen && (
        <EmojiPicker
          anchor={emojiBtn.current}
          custom={mentionables.emoji}
          onClose={() => setEmojiOpen(false)}
          onPick={(p) => {
            if (p.kind === 'unicode') {
              insertAtCaret(p.char);
              noteEmojiUse(p.char);
            } else {
              const shown = `:${p.emoji.name}:`;
              tokens.current.set(shown, `<${p.emoji.animated ? 'a' : ''}:${p.emoji.name}:${p.emoji.id}>`);
              insertAtCaret(shown + ' ');
              noteEmojiUse(`custom:${p.emoji.id}`);
            }
          }}
        />
      )}
      {pollOpen && (
        <PollModal
          onClose={() => setPollOpen(false)}
          onCreate={async (poll) => {
            setPollOpen(false);
            await submit('', [], { poll });
          }}
        />
      )}
      {scheduleOpen && (
        <ScheduleModal
          canRepeat={canRepeat}
          hasText={Boolean(text.trim() || files.length)}
          onClose={() => setScheduleOpen(false)}
          onSchedule={(at, repeat) => {
            setScheduleOpen(false);
            submit(text, [], { scheduleAt: at, repeat });
          }}
        />
      )}
    </div>
  );
}

function atHour(h: number, addDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(h, 0, 0, 0);
  if (d.getTime() < Date.now() + 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function renderMistakes(text: string, mistakes: { start: number; end: number }[]) {
  const out: ReactNode[] = [];
  let at = 0;
  mistakes.forEach((m, i) => {
    out.push(text.slice(at, m.start));
    out.push(
      <span key={i} className="spell-wrong">
        {text.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  });
  out.push(text.slice(at) + '\n');
  return out;
}

// Live formatting inside the message box (Discord-style): only text-styling
// tokens are transformed so the overlay stays aligned with the textarea.
const PREVIEW_TOKENS: { re: RegExp; wrap: (m: RegExpExecArray, inner: ReactNode) => ReactNode }[] = [
  { re: /`([^`\n]+)`/, wrap: (_m, inner) => <code className="md-code">{inner}</code> },
  { re: /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/, wrap: (_m, inner) => inner },
  { re: /\|\|([\s\S]+?)\|\|/, wrap: (_m, inner) => inner },
  { re: /\*\*\*([\s\S]+?)\*\*\*/, wrap: (m, inner) => <>{m[0].slice(0, 3)}<strong><em>{inner}</em></strong>{m[0].slice(-3)}</> },
  { re: /\*\*([\s\S]+?)\*\*/, wrap: (m, inner) => <>{m[0].slice(0, 2)}<strong>{inner}</strong>{m[0].slice(-2)}</> },
  { re: /__([\s\S]+?)__/, wrap: (_m, inner) => <u>{inner}</u> },
  { re: /\*([^*\s][\s\S]*?)\*|\b_([^_\s][\s\S]*?)_\b/, wrap: (_m, inner) => <em>{inner}</em> },
  { re: /~~([\s\S]+?)~~/, wrap: (_m, inner) => <s>{inner}</s> },
];

function renderPreview(text: string, ns = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { t: (typeof PREVIEW_TOKENS)[number]; m: RegExpExecArray } | null = null;
    for (const t of PREVIEW_TOKENS) {
      const m = t.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { t, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { t, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${ns}${n++}`;
    out.push(<Fragment key={k}>{t.wrap(m, renderPreview(m[1] ?? m[2], `${k}-`))}</Fragment>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function PendingFileCard({
  f,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  f: PendingFile;
  first: boolean;
  last: boolean;
  onChange: (f: PendingFile) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!f.file.type.startsWith('image/') || f.file.size > 30 * 1024 * 1024) return;
    const u = URL.createObjectURL(f.file);
    setThumb(u);
    return () => URL.revokeObjectURL(u);
  }, [f.file]);
  return (
    <div className={`pending-file${f.spoiler ? ' spoiler' : ''}`} role="listitem">
      <div className="pending-thumb">{thumb ? <img src={thumb} alt="" /> : <Icon name="file" size={22} />}</div>
      <div className="pending-info">
        <span className="ellipsis" title={f.file.name}>
          {f.file.name}
        </span>
        <span className="muted small">
          {formatSize(f.file.size)}
          {f.spoiler ? ' · spoiler' : ''}
          {f.alt ? ' · has description' : ''}
        </span>
      </div>
      <div className="pending-actions">
        {!first && (
          <button className="icon-btn small" onClick={() => onMove(-1)} title="Move left" aria-label="Move earlier">
            ‹
          </button>
        )}
        {!last && (
          <button className="icon-btn small" onClick={() => onMove(1)} title="Move right" aria-label="Move later">
            ›
          </button>
        )}
        <button
          className={`icon-btn small${f.spoiler ? ' active' : ''}`}
          onClick={() => onChange({ ...f, spoiler: !f.spoiler })}
          title={f.spoiler ? 'Unmark spoiler' : 'Mark as spoiler'}
          aria-pressed={f.spoiler}
          aria-label="Spoiler"
        >
          <Icon name={f.spoiler ? 'eyeOff' : 'eye'} size={14} />
        </button>
        <button
          className="icon-btn small"
          onClick={async () => {
            const alt = await askText({ title: 'Describe this file', label: 'Description (alt text)', initial: f.alt, maxLength: 500, hint: 'Read out by screen readers. It’s encrypted with the message.' });
            if (alt !== null) onChange({ ...f, alt: alt.trim() });
          }}
          title="Add a description (alt text)"
          aria-label="Description"
        >
          <Icon name="edit" size={14} />
        </button>
        <button className="icon-btn small" onClick={onRemove} title="Remove" aria-label={`Remove ${f.file.name}`}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

function PollModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: PollDraft) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [hours, setHours] = useState<string>('24');
  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <Modal title="Create a poll" onClose={onClose}>
      <Field label="Question">
        <input maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we play tonight?" />
      </Field>
      <Field label="Answers" hint="2 to 10">
        <div className="poll-edit">
          {options.map((o, i) => (
            <div key={i} className="copy-row">
              <input maxLength={100} value={o} placeholder={`Answer ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              {options.length > 2 && (
                <button className="icon-btn" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove answer">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button className="btn link small" onClick={() => setOptions([...options, ''])}>
              + Add answer
            </button>
          )}
        </div>
      </Field>
      <div className="row">
        <Field label="Ends after">
          <Select
            value={hours}
            onChange={setHours}
            options={[
              { value: '1', label: '1 hour' },
              { value: '4', label: '4 hours' },
              { value: '8', label: '8 hours' },
              { value: '24', label: '1 day' },
              { value: '72', label: '3 days' },
              { value: '168', label: '1 week' },
              { value: '', label: 'Never' },
            ]}
          />
        </Field>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Allow more than one answer
      </label>
      <label className="check-row">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous: show totals but not who voted
      </label>
      <p className="small muted">The question and answers are end-to-end encrypted. Venband only counts votes by answer number.</p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() =>
            onCreate({ question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), multi, anonymous, hours: hours ? Number(hours) : null })
          }
        >
          Post poll
        </button>
      </div>
    </Modal>
  );
}

function ScheduleModal({
  onClose,
  onSchedule,
  canRepeat,
  hasText,
}: {
  onClose: () => void;
  onSchedule: (at: number, repeat?: { every: 'day' | 'week'; times: number }) => void;
  canRepeat: boolean;
  hasText: boolean;
}) {
  const local = (ms: number) => {
    const d = new Date(ms);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const [when, setWhen] = useState(local(Date.now() + 3_600_000));
  const [repeat, setRepeat] = useState<'' | 'day' | 'week'>('');
  const [times, setTimes] = useState('5');
  const at = new Date(when).getTime();
  const ok = hasText && at > Date.now() + 30_000 && at < Date.now() + 365 * 86_400_000;
  return (
    <Modal title="Send later" onClose={onClose}>
      {!hasText && <div className="notice small">Type a message first, then schedule it.</div>}
      <div className="chip-row">
        {[
          ['In 1 hour', Date.now() + 3_600_000],
          ['Tonight 8 PM', atHour(20)],
          ['Tomorrow 9 AM', atHour(9, 1)],
          ['In 1 week', Date.now() + 7 * 86_400_000],
        ].map(([label, ms]) => (
          <button key={label as string} className="chip" onClick={() => setWhen(local(ms as number))}>
            {label as string}
          </button>
        ))}
      </div>
      <Field label="Date and time">
        <input type="datetime-local" value={when} min={local(Date.now())} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      {canRepeat && (
        <div className="row">
          <Field label="Repeat">
            <Select
              value={repeat}
              onChange={(v) => setRepeat(v as '' | 'day' | 'week')}
              options={[
                { value: '', label: 'Don’t repeat' },
                { value: 'day', label: 'Every day' },
                { value: 'week', label: 'Every week' },
              ]}
            />
          </Field>
          {repeat && (
            <Field label="How many times">
              <input type="number" min={2} max={30} value={times} onChange={(e) => setTimes(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <p className="small muted">The message is encrypted now, on this device, and delivered at that time even if you’re offline.</p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!ok} onClick={() => onSchedule(at, repeat ? { every: repeat, times: Math.max(2, Math.min(30, Number(times) || 2)) } : undefined)}>
          Schedule
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- typing --

export const typingChannels = new Map<string, ReturnType<typeof supabase.channel>>();

/**
 * Who is typing. `key` is what the composer uses ("<channel>" or
 * "<channel>:<thread root>"); threads get their own realtime topic.
 */
export function useTyping(key: string) {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const me = sessionStore.use((s) => s.identity?.userId);
  useEffect(() => {
    setTyping({});
    const [channelId, thread] = key.split(':');
    const ch = supabase.channel(`chan:${channelId}${thread ? `:t${thread.slice(0, 8)}` : ''}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const uid = (payload as { user_id?: string }).user_id;
      if (uid && uid !== me && !socialStore.get().relations[uid]?.blocked) setTyping((t) => ({ ...t, [uid]: Date.now() }));
    });
    ch.subscribe();
    typingChannels.set(key, ch);
    const tick = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => Date.now() - v < 5000))), 1000);
    return () => {
      clearInterval(tick);
      typingChannels.delete(key);
      supabase.removeChannel(ch);
    };
  }, [key, me]);
  return typing;
}

function useTypingSender(channelId: string) {
  const me = sessionStore.use((s) => s.identity?.userId);
  const hideTyping = useSettings((s) => (s as unknown as { privacy?: { hideTyping?: boolean } }).privacy?.hideTyping);
  return () => {
    if (hideTyping) return;
    typingChannels.get(channelId)?.send({ type: 'broadcast', event: 'typing', payload: { user_id: me } });
  };
}

/** Pixel position of a character inside a textarea (mirror-div technique). */
function caretCoords(el: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const div = document.createElement('div');
  const cs = getComputedStyle(el);
  for (const p of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'whiteSpace', 'wordWrap', 'tabSize'] as const)
    div.style[p] = cs[p];
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.overflowWrap = 'break-word';
  div.textContent = el.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = el.value.slice(index) || '.';
  div.appendChild(mark);
  document.body.appendChild(div);
  const out = { top: mark.offsetTop - el.scrollTop, left: mark.offsetLeft - el.scrollLeft };
  div.remove();
  return out;
}
