import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { decryptBlob, encryptBlob, type Attachment, type MessagePayload } from '../lib/crypto';
import { displayName, getProfile, trustState } from '../lib/directory';
import type { DecryptedMessage } from '../lib/keyring';
import type { Channel, MessageRow } from '../lib/types';
import { useMessages, type ServerData } from '../hooks/data';
import { Avatar, Icon } from './ui';
import { ProfileModal } from './Modals';

const MAX_TEXT = 4000;
const MAX_FILE = 25 * 1024 * 1024;

export function ChatView({
  channel,
  title,
  canSend,
  canManage,
  headerExtra,
  data,
}: {
  channel: Channel;
  title: string;
  canSend: boolean;
  canManage: boolean;
  headerExtra?: ReactNode;
  data?: ServerData;
}) {
  const { messages, hasMore, loadOlder, keyStatus, upsertLocal, removeLocal } = useMessages(channel);
  const identity = sessionStore.use((s) => s.identity)!;
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const typingAt = useTyping(channel.id);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const byId = useMemo(() => new Map(messages.map((m) => [m.row.id, m])), [messages]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    stick.current = true;
    setReplyTo(null);
    setEditing(null);
  }, [channel.id]);

  // hide "typing…" for people whose message already arrived
  const typing = Object.entries(typingAt)
    .filter(([uid, at]) => !messages.some((m) => m.row.author_id === uid && new Date(m.row.created_at).getTime() >= at - 1000))
    .map(([uid]) => uid);
  const nameOf = (userId: string) => displayName(userId, data?.members.find((m) => m.user_id === userId)?.nickname);
  const colorOf = (userId: string) => data?.rolesOf(userId).find((r) => r.color !== '#99aab5')?.color;

  async function send(text: string, files: File[]) {
    const keyring = sessionStore.get().keyring!;
    await keyring.prepareSend(channel.id);
    const attachments: Attachment[] = [];
    for (const f of files) {
      const { blob, key, iv } = await encryptBlob(await f.arrayBuffer());
      const path = `${channel.id}/${crypto.randomUUID()}.bin`;
      const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'application/octet-stream' });
      if (error) throw error;
      attachments.push({ path, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, key, iv });
    }
    const id = crypto.randomUUID();
    const payload: MessagePayload = { v: 1, text, sentAt: Date.now(), ...(attachments.length ? { attachments } : {}) };
    const env = await keyring.encrypt(channel.id, id, payload);
    const row = {
      id,
      channel_id: channel.id,
      author_id: identity.userId,
      author_key_id: env.author_key_id,
      epoch: env.epoch,
      iv: env.iv,
      ciphertext: env.ciphertext,
      signature: env.signature,
      reply_to: replyTo?.row.id ?? null,
    };
    const { data: inserted, error } = await supabase.from('messages').insert(row).select().single();
    if (error) throw error;
    stick.current = true;
    upsertLocal(inserted as MessageRow);
    setReplyTo(null);
  }

  async function saveEdit(m: DecryptedMessage, text: string) {
    const keyring = sessionStore.get().keyring!;
    await keyring.prepareSend(channel.id);
    const env = await keyring.encrypt(channel.id, m.row.id, { ...m.payload!, text });
    const { data: updated, error } = await supabase
      .from('messages')
      .update({ epoch: env.epoch, iv: env.iv, ciphertext: env.ciphertext, signature: env.signature, author_key_id: env.author_key_id })
      .eq('id', m.row.id)
      .select()
      .single();
    if (error) throw error;
    upsertLocal(updated as MessageRow);
    setEditing(null);
  }

  async function remove(m: DecryptedMessage) {
    if (!confirm('Delete this message?')) return;
    const { error } = await supabase.from('messages').delete().eq('id', m.row.id);
    if (error) return alert(errorMessage(error));
    for (const a of m.payload?.attachments ?? []) supabase.storage.from('attachments').remove([a.path]);
    removeLocal(m.row.id);
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <Icon name={channel.type === 'dm' ? 'message' : 'hash'} />
        <h3>{title}</h3>
        <span className="lock-hint" title="End-to-end encrypted: only people in this conversation can read it.">
          <Icon name="lock" size={13} />
        </span>
        {channel.topic && <span className="topic">{channel.topic}</span>}
        <div className="chat-header-actions">{headerExtra}</div>
      </header>
      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasMore && (
          <button className="btn link load-older" onClick={() => ((stick.current = false), loadOlder())}>
            Load older messages
          </button>
        )}
        {!hasMore && (
          <div className="channel-intro">
            <div className="channel-intro-icon">
              <Icon name={channel.type === 'dm' ? 'message' : 'hash'} size={36} />
            </div>
            <h1>{channel.type === 'dm' ? title : `#${title}`}</h1>
            <p className="muted">
              {channel.type === 'dm'
                ? `This is the start of your conversation with ${title}.`
                : `This is the start of #${title}.`}{' '}
              Only the people in here can read it.
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped =
            prev &&
            prev.row.author_id === m.row.author_id &&
            !m.row.reply_to &&
            new Date(m.row.created_at).getTime() - new Date(prev.row.created_at).getTime() < 5 * 60_000;
          const newDay = !prev || new Date(prev.row.created_at).toDateString() !== new Date(m.row.created_at).toDateString();
          const mine = m.row.author_id === identity.userId;
          return (
            <Fragment key={m.row.id}>
              {newDay && (
                <div className="day-divider">
                  <span>{new Date(m.row.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}</span>
                </div>
              )}
              <MessageItem
                m={m}
                grouped={Boolean(grouped) && !newDay}
                name={nameOf(m.row.author_id)}
                color={colorOf(m.row.author_id)}
                reply={m.row.reply_to ? byId.get(m.row.reply_to) ?? null : null}
                replyName={m.row.reply_to && byId.get(m.row.reply_to) ? nameOf(byId.get(m.row.reply_to)!.row.author_id) : ''}
                editing={editing === m.row.id}
                canEdit={mine && Boolean(m.payload)}
                canDelete={mine || canManage}
                onReply={() => setReplyTo(m)}
                onEdit={() => setEditing(m.row.id)}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={(t) => saveEdit(m, t)}
                onDelete={() => remove(m)}
                onProfile={() => setProfileOf(m.row.author_id)}
              />
            </Fragment>
          );
        })}
      </div>
      {keyStatus === 'waiting' && (
        <div className="key-wait">
          <Icon name="lock" size={16} /> Waiting for another member to come online and share this channel’s encryption key
          with you…
        </div>
      )}
      <div className="typing">{typing.length > 0 && `${typing.map((u) => nameOf(u)).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`}</div>
      <Composer
        channelId={channel.id}
        placeholder={canSend ? `Message ${channel.type === 'dm' ? '@' + title : '#' + title}` : 'You do not have permission to send messages here'}
        disabled={!canSend || keyStatus !== 'ready'}
        replyTo={replyTo ? nameOf(replyTo.row.author_id) : null}
        onCancelReply={() => setReplyTo(null)}
        onSend={send}
      />
      {profileOf && <ProfileModal userId={profileOf} data={data} onClose={() => setProfileOf(null)} />}
    </div>
  );
}

function MessageItem({
  m,
  grouped,
  name,
  color,
  reply,
  replyName,
  editing,
  canEdit,
  canDelete,
  onReply,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onProfile,
}: {
  m: DecryptedMessage;
  grouped: boolean;
  name: string;
  color?: string;
  reply: DecryptedMessage | null;
  replyName: string;
  editing: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (t: string) => Promise<void>;
  onDelete: () => void;
  onProfile: () => void;
}) {
  const time = new Date(m.row.created_at);
  const trust = trustState(m.row.author_id);
  return (
    <div className={`message${grouped ? ' grouped' : ''}`}>
      {m.row.reply_to && (
        <div className="reply-ref">
          <Icon name="reply" size={14} />
          {reply ? (
            <>
              <b>{replyName}</b> <span>{reply.payload?.text.slice(0, 120) ?? '…'}</span>
            </>
          ) : (
            <span className="muted">Original message not loaded</span>
          )}
        </div>
      )}
      <div className="message-row">
        {grouped ? (
          <span className="hover-time">{time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        ) : (
          <button className="avatar-btn" onClick={onProfile}>
            <Avatar profile={getProfile(m.row.author_id)} size={40} />
          </button>
        )}
        <div className="message-body">
          {!grouped && (
            <div className="message-meta">
              <button className="author" style={{ color }} onClick={onProfile}>
                {name}
              </button>
              {trust === 'changed' && (
                <span className="trust-warn" title="This user's security key changed. Verify their fingerprint.">
                  <Icon name="warning" size={14} />
                </span>
              )}
              {trust === 'verified' && (
                <span className="trust-ok" title="Verified security key">
                  <Icon name="check" size={14} />
                </span>
              )}
              <time dateTime={m.row.created_at} title={time.toLocaleString()}>
                {friendlyTime(time)}
              </time>
            </div>
          )}
          {m.error === 'missing-key' && (
            <div className="undecryptable">
              <Icon name="lock" size={14} /> Encrypted message — waiting for the key.
            </div>
          )}
          {m.error === 'invalid' && (
            <div className="undecryptable bad">
              <Icon name="warning" size={14} /> This message failed signature verification and was hidden.
            </div>
          )}
          {m.payload &&
            (editing ? (
              <EditBox initial={m.payload.text} onCancel={onCancelEdit} onSave={onSaveEdit} />
            ) : (
              <div className="message-text">
                <RichText text={m.payload.text} />
                {m.row.edited_at && <span className="edited">(edited)</span>}
              </div>
            ))}
          {m.payload?.attachments?.map((a) => <AttachmentView key={a.path} a={a} />)}
        </div>
        <div className="message-actions">
          {m.payload && (
            <button className="icon-btn" onClick={onReply} title="Reply">
              <Icon name="reply" size={16} />
            </button>
          )}
          {canEdit && (
            <button className="icon-btn" onClick={onEdit} title="Edit">
              <Icon name="edit" size={16} />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn danger-text" onClick={onDelete} title="Delete">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="edit-box">
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_TEXT}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) onSave(text.trim()).catch((err) => setError(errorMessage(err)));
          }
        }}
      />
      <span className="small muted">
        escape to <button className="btn link" onClick={onCancel}>cancel</button> • enter to save
        {error && <span className="danger-text"> — {error}</span>}
      </span>
    </div>
  );
}

// Safe rendering: never uses innerHTML. Supports links, `code`, ```blocks```, **bold**, *italic*.
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const blocks = text.split(/```/);
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      parts.push(
        <pre key={i}>
          <code>{block.replace(/^\w*\n/, '')}</code>
        </pre>,
      );
      return;
    }
    const re = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let k = 0;
    while ((match = re.exec(block))) {
      if (match.index > last) parts.push(block.slice(last, match.index));
      if (match[1]) {
        parts.push(
          <a key={`${i}-${k++}`} href={match[1]} target="_blank" rel="noopener noreferrer nofollow">
            {match[1]}
          </a>,
        );
      } else if (match[2]) parts.push(<code key={`${i}-${k++}`}>{match[2]}</code>);
      else if (match[3]) parts.push(<strong key={`${i}-${k++}`}>{match[3]}</strong>);
      else if (match[4]) parts.push(<em key={`${i}-${k++}`}>{match[4]}</em>);
      last = re.lastIndex;
    }
    if (last < block.length) parts.push(block.slice(last));
  });
  return <>{parts}</>;
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm))$/;

function AttachmentView({ a }: { a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const inline = SAFE_INLINE.test(a.mime);

  async function load(): Promise<string | null> {
    if (url) return url;
    const { data, error } = await supabase.storage.from('attachments').download(a.path);
    if (error || !data) {
      setError(true);
      return null;
    }
    try {
      const plain = await decryptBlob(await data.arrayBuffer(), a.key, a.iv);
      const u = URL.createObjectURL(new Blob([plain], { type: inline ? a.mime : 'application/octet-stream' }));
      setUrl(u);
      return u;
    } catch {
      setError(true);
      return null;
    }
  }

  useEffect(() => {
    if (inline && a.size < 10 * 1024 * 1024) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.path]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  if (error) return <div className="attachment bad">Could not decrypt {a.name}</div>;
  if (url && a.mime.startsWith('image/')) return <img className="attachment-img" src={url} alt={a.name} />;
  if (url && a.mime.startsWith('video/')) return <video className="attachment-img" src={url} controls />;
  if (url && a.mime.startsWith('audio/')) return <audio src={url} controls />;
  return (
    <div className="attachment">
      <Icon name="file" size={28} />
      <div>
        <div className="attachment-name">{a.name}</div>
        <div className="small muted">{formatSize(a.size)} · encrypted</div>
      </div>
      <button
        className="icon-btn"
        title="Download"
        onClick={async () => {
          const u = await load();
          if (!u) return;
          const link = document.createElement('a');
          link.href = u;
          link.download = a.name;
          link.click();
        }}
      >
        <Icon name="download" />
      </button>
    </div>
  );
}

function Composer({
  channelId,
  placeholder,
  disabled,
  replyTo,
  onCancelReply,
  onSend,
}: {
  channelId: string;
  placeholder: string;
  disabled: boolean;
  replyTo: string | null;
  onCancelReply: () => void;
  onSend: (text: string, files: File[]) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const sendTyping = useTypingSender(channelId);

  useEffect(() => {
    setText('');
    setFiles([]);
    setError(null);
  }, [channelId]);

  async function submit() {
    const t = text.trim();
    if ((!t && !files.length) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(t, files);
      setText('');
      setFiles([]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="composer-wrap">
      {replyTo && (
        <div className="replying">
          Replying to <b>{replyTo}</b>
          <button className="icon-btn" onClick={onCancelReply}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f, i) => (
            <div key={i} className="pending-file">
              <Icon name="file" size={16} /> {f.name}
              <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className={`composer${disabled ? ' disabled' : ''}`}>
        <button className="icon-btn" disabled={disabled} onClick={() => fileInput.current?.click()} title="Attach encrypted file">
          <Icon name="plus" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            const tooBig = picked.find((f) => f.size > MAX_FILE);
            if (tooBig) setError(`${tooBig.name} is larger than 25 MB.`);
            setFiles((f) => [...f, ...picked.filter((x) => x.size <= MAX_FILE)].slice(0, 10));
            e.target.value = '';
          }}
        />
        <textarea
          rows={1}
          value={text}
          maxLength={MAX_TEXT}
          disabled={disabled || busy}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              sendTyping();
            }
          }}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) setFiles((f) => [...f, ...pasted.filter((x) => x.size <= MAX_FILE)].slice(0, 10));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy && <div className="spinner small" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- typing --

const typingChannels = new Map<string, ReturnType<typeof supabase.channel>>();

function useTyping(channelId: string) {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const me = sessionStore.use((s) => s.identity?.userId);
  useEffect(() => {
    setTyping({});
    const ch = supabase.channel(`chan:${channelId}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const uid = (payload as { user_id?: string }).user_id;
      if (uid && uid !== me) setTyping((t) => ({ ...t, [uid]: Date.now() }));
    });
    ch.subscribe();
    typingChannels.set(channelId, ch);
    const tick = setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => Date.now() - v < 5000))), 1000);
    return () => {
      clearInterval(tick);
      typingChannels.delete(channelId);
      supabase.removeChannel(ch);
    };
  }, [channelId, me]);
  return typing;
}

function useTypingSender(channelId: string) {
  const me = sessionStore.use((s) => s.identity?.userId);
  return () => {
    typingChannels.get(channelId)?.send({ type: 'broadcast', event: 'typing', payload: { user_id: me } });
  };
}

function friendlyTime(d: Date): string {
  const clock = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Today at ${clock}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${clock}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${clock}`;
}
