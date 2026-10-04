import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import type { Attachment, MessagePayload } from '../lib/crypto';
import { copyAttachment, MAX_FILE, removeAttachment, uploadEncrypted } from '../lib/files';
import { AttachmentView, formatSize } from './Attachments';
import { linkTo } from '../lib/router';
import { uiStore } from '../lib/ui';
import { Modal } from './ui';
import { displayName, getProfile, loadProfiles, trustState } from '../lib/directory';
import type { DecryptedMessage } from '../lib/keyring';
import type { Channel, MessageRow, Profile } from '../lib/types';
import { openChannel, useMessages, type ServerData } from '../hooks/data';
import { setViewingChannel } from '../lib/notify';
import { socialStore } from '../lib/social';
import { useSettings } from '../lib/settings';
import { languageName, translate, translationSupported, type Translation } from '../lib/translate';
import { containsSlur } from '../lib/automod';
import { Avatar, Icon } from './ui';
import { Badges } from './Badges';
import { copyText, openMenu, type Entry } from './ContextMenu';
import { askConfirm, askText } from './Dialogs';
import { loadMyReports, myReports, reportMessage } from '../lib/reports';
import { Embed, findEmbeds, isBareGif, Markdown, mentionsMe, type MentionContext } from './Markdown';
import { GifPicker, toggleGifFavorite } from './GifPicker';
import { openProfile, ServerTag, userMenu } from './People';

const MAX_TEXT = 4000;

interface JoinEvent {
  id: string;
  user_id: string;
  created_at: string;
}

/** "X joined the server" events for the server's welcome channel. */
function useJoinEvents(serverId: string | null) {
  const [events, setEvents] = useState<JoinEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (!serverId) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('server_events')
        .select('id, user_id, created_at')
        .eq('server_id', serverId)
        .eq('kind', 'join')
        .order('created_at', { ascending: false })
        .limit(100);
      const rows = (data ?? []) as JoinEvent[];
      await loadProfiles(rows.map((r) => r.user_id));
      if (!cancelled) setEvents(rows.reverse());
    };
    load();
    const ch = supabase
      .channel(`dbs:${serverId}:events`, { config: { private: true } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_events', filter: `server_id=eq.${serverId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [serverId]);
  return events;
}

const JOIN_LINES = [
  (n: ReactNode) => <>Everyone welcome {n}!</>,
  (n: ReactNode) => <>{n} just landed.</>,
  (n: ReactNode) => <>{n} joined the party.</>,
  (n: ReactNode) => <>Glad you’re here, {n}.</>,
  (n: ReactNode) => <>{n} just showed up. Say hi!</>,
  (n: ReactNode) => <>Welcome, {n}. We hope you brought snacks.</>,
  (n: ReactNode) => <>{n} hopped into the server.</>,
];

export function ChatView({
  channel,
  title,
  canSend,
  canManage,
  headerExtra,
  data,
  dmMembers,
}: {
  channel: Channel;
  title: string;
  canSend: boolean;
  canManage: boolean;
  headerExtra?: ReactNode;
  data?: ServerData;
  /** other people in a DM / group (for @mentions) */
  dmMembers?: Profile[];
}) {
  const { messages, hasMore, loadOlder, keyStatus, upsertLocal, removeLocal } = useMessages(channel);
  const identity = sessionStore.use((s) => s.identity)!;
  const me = sessionStore.use((s) => s.me)!;
  const relations = socialStore.use((s) => s.relations);
  const showJoins = useSettings((s) => s.chat.showJoins);
  const isWelcome = Boolean(data?.server?.welcome_channel_id && data.server.welcome_channel_id === channel.id);
  const joins = useJoinEvents(isWelcome && showJoins ? (data?.server?.id ?? null) : null);
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const typingAt = useTyping(channel.id);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const byId = useMemo(() => new Map(messages.map((m) => [m.row.id, m])), [messages]);
  const automod = Boolean(data?.server?.automod?.slurs);
  const myRoleIds = data?.rolesOf(me.id).map((r) => r.id) ?? [];

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, joins]);

  useEffect(() => {
    loadMyReports();
  }, []);

  // opened from a message link: scroll to it and flash it
  const jump = uiStore.use((s) => s.jump);
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(`m-${jump}`);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2400);
    uiStore.set({ jump: null });
  }, [jump, messages]);

  useEffect(() => {
    stick.current = true;
    setReplyTo(null);
    setEditing(null);
    setViewingChannel(channel.id);
    return () => setViewingChannel(null);
  }, [channel.id]);

  // hide "typing…" for people whose message already arrived
  const typing = Object.entries(typingAt)
    .filter(([uid, at]) => !messages.some((m) => m.row.author_id === uid && new Date(m.row.created_at).getTime() >= at - 1000))
    .map(([uid]) => uid);
  const nameOf = (userId: string) => displayName(userId, data?.members.find((m) => m.user_id === userId)?.nickname);
  const colorOf = (userId: string) => data?.rolesOf(userId).find((r) => r.color !== '#99aab5')?.color;

  const mentionCtx: MentionContext = {
    userName: (id) => (getProfile(id) ? nameOf(id) : null),
    roleOf: (id) => {
      const r = data?.roles.find((x) => x.id === id);
      return r ? { name: r.name, color: r.color } : null;
    },
    channelName: (id) => data?.channels.find((c) => c.id === id)?.name ?? null,
    isMe: (id) => id === me.id,
    myRoleIds,
    onUser: (id) => openProfile(id, data?.server?.id),
    onChannel: (id) => data?.server && openChannel(data.server.id, id),
  };

  async function sendPayload(text: string, files: File[], onProgress?: (fraction: number) => void) {
    if (automod && containsSlur(text)) throw new Error('AutoMod blocked this message: it contains a slur this server doesn’t allow.');
    const keyring = sessionStore.get().keyring!;
    await keyring.prepareSend(channel.id);
    const attachments: Attachment[] = [];
    const totalBytes = files.reduce((n, f) => n + f.size, 0) || 1;
    let doneBytes = 0;
    for (const f of files) {
      attachments.push(await uploadEncrypted(channel.id, f, (p) => onProgress?.((doneBytes + p * f.size) / totalBytes)));
      doneBytes += f.size;
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
    if (automod && containsSlur(text)) throw new Error('AutoMod blocked this edit.');
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

  async function remove(m: DecryptedMessage, skipConfirm = false) {
    if (!skipConfirm && !(await askConfirm({ title: 'Delete message', body: 'Delete this message for everyone?', confirm: 'Delete', danger: true }))) return;
    const { error } = await supabase.from('messages').delete().eq('id', m.row.id);
    if (error) return alert(errorMessage(error));
    for (const a of m.payload?.attachments ?? []) removeAttachment(a);
    removeLocal(m.row.id);
  }

  // messages and join notices, in time order
  const timeline = useMemo(() => {
    const items: ({ kind: 'msg'; m: DecryptedMessage; at: string } | { kind: 'join'; e: JoinEvent; at: string })[] = messages.map((m) => ({
      kind: 'msg' as const,
      m,
      at: m.row.created_at,
    }));
    const oldest = messages[0]?.row.created_at;
    for (const e of joins) if (!hasMore || !oldest || e.created_at >= oldest) items.push({ kind: 'join', e, at: e.created_at });
    return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [messages, joins, hasMore]);

  const mentionables = useMemo(() => {
    const people: Profile[] = data
      ? (data.members.map((m) => getProfile(m.user_id)).filter(Boolean) as Profile[])
      : [me, ...(dmMembers ?? [])];
    return {
      people: people.map((p) => ({ id: p.id, label: nameOf(p.id), sub: p.username, profile: p })),
      roles: (data?.roles ?? []).filter((r) => !r.is_default).map((r) => ({ id: r.id, label: r.name, color: r.color })),
      channels: (data?.channels ?? []).filter((c) => c.type === 'text').map((c) => ({ id: c.id, label: c.name })),
      everyone: Boolean(data),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dmMembers, me]);

  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');

  return (
    <div
      className="chat"
      onDragEnter={(e) => {
        if (!hasFiles(e) || !canSend) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => hasFiles(e) && canSend && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e) || !canSend) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        setDropped([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Icon name="upload" size={40} />
            <b>Drop to send to {channel.type === 'dm' ? title : `#${title}`}</b>
            <span className="small muted">Up to 10 files, 5 GB each. Encrypted on your device before upload.</span>
          </div>
        </div>
      )}
      <header className="chat-header">
        <Icon name={channel.type === 'dm' ? 'message' : 'hash'} />
        <h3>{title}</h3>
        <span className="lock-hint" title="End-to-end encrypted: only people in this conversation can read it.">
          <Icon name="lock" size={13} />
        </span>
        {channel.topic && (
          <span className="topic">
            <Markdown text={channel.topic} ctx={mentionCtx} />
          </span>
        )}
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
              <Icon name={isWelcome ? 'hand' : channel.type === 'dm' ? 'message' : 'hash'} size={36} />
            </div>
            <h1>{isWelcome ? `Welcome to ${data?.server?.name}` : channel.type === 'dm' ? title : `#${title}`}</h1>
            <p className="muted">
              {isWelcome
                ? 'This is the beginning of the server. New members are announced here.'
                : channel.type === 'dm'
                  ? `This is the start of your conversation with ${title}.`
                  : `This is the start of #${title}.`}{' '}
              Only the people in here can read it.
            </p>
          </div>
        )}
        {timeline.map((item, i) => {
          const prevItem = timeline[i - 1];
          const newDay = !prevItem || new Date(prevItem.at).toDateString() !== new Date(item.at).toDateString();
          const divider = newDay && (
            <div className="day-divider">
              <span>{new Date(item.at).toLocaleDateString(undefined, { dateStyle: 'long' })}</span>
            </div>
          );
          if (item.kind === 'join') {
            const line = JOIN_LINES[parseInt(item.e.id.slice(0, 4), 16) % JOIN_LINES.length];
            return (
              <Fragment key={item.e.id}>
                {divider}
                <div className="system-message">
                  <span className="system-icon">
                    <Icon name="userPlus" size={16} />
                  </span>
                  <span>
                    {line(
                      <button
                        className="author"
                        onClick={() => openProfile(item.e.user_id, data?.server?.id)}
                        onContextMenu={(e) => openMenu(e, userMenu(item.e.user_id, { data }))}
                      >
                        {nameOf(item.e.user_id)}
                      </button>,
                    )}
                  </span>
                  <time dateTime={item.e.created_at}>{friendlyTime(new Date(item.e.created_at))}</time>
                </div>
              </Fragment>
            );
          }
          const m = item.m;
          const prev = prevItem?.kind === 'msg' ? prevItem.m : null;
          const grouped =
            prev &&
            prev.row.author_id === m.row.author_id &&
            !m.row.reply_to &&
            new Date(m.row.created_at).getTime() - new Date(prev.row.created_at).getTime() < 5 * 60_000;
          const mine = m.row.author_id === identity.userId;
          return (
            <Fragment key={m.row.id}>
              {divider}
              <MessageItem
                m={m}
                grouped={Boolean(grouped) && !newDay}
                name={nameOf(m.row.author_id)}
                mine={mine}
                color={colorOf(m.row.author_id)}
                reply={m.row.reply_to ? byId.get(m.row.reply_to) ?? null : null}
                replyName={m.row.reply_to && byId.get(m.row.reply_to) ? nameOf(byId.get(m.row.reply_to)!.row.author_id) : ''}
                editing={editing === m.row.id}
                canEdit={mine && Boolean(m.payload)}
                canDelete={mine || canManage}
                blocked={!mine && Boolean(relations[m.row.author_id]?.blocked)}
                automod={automod}
                mentioned={!mine && Boolean(m.payload) && mentionsMe(m.payload!.text, me.id, myRoleIds, channel.type !== 'dm')}
                ctx={mentionCtx}
                data={data}
                onReply={() => setReplyTo(m)}
                onEdit={() => setEditing(m.row.id)}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={(t) => saveEdit(m, t)}
                onDelete={(skip) => remove(m, skip)}
                onReport={async () => {
                  const reason = await askText({
                    title: 'Report message',
                    label: 'What’s wrong with it?',
                    placeholder: 'Harassment, spam, threats…',
                    hint: 'This message and a few around it are shared with Venband staff so they can review it.',
                    maxLength: 1000,
                  });
                  if (!reason?.trim()) return;
                  try {
                    await reportMessage(m, messages, reason.trim(), data?.server?.id ?? null);
                  } catch (e) {
                    alert(errorMessage(e));
                  }
                }}
              />
            </Fragment>
          );
        })}
      </div>
      <div className="typing">{typing.length > 0 && `${typing.map((u) => nameOf(u)).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`}</div>
      <Composer
        channelId={channel.id}
        placeholder={canSend ? `Message ${channel.type === 'dm' ? '@' + title : '#' + title}` : 'You do not have permission to send messages here'}
        disabled={!canSend || keyStatus === 'loading'}
        replyTo={replyTo ? nameOf(replyTo.row.author_id) : null}
        onCancelReply={() => setReplyTo(null)}
        onSend={sendPayload}
        mentionables={mentionables}
        incoming={dropped}
        onIncomingTaken={() => setDropped([])}
      />
    </div>
  );
}

function MessageItem({
  m,
  grouped,
  name,
  mine,
  color,
  reply,
  replyName,
  editing,
  canEdit,
  canDelete,
  blocked,
  automod,
  mentioned,
  ctx,
  data,
  onReply,
  onReport,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  m: DecryptedMessage;
  grouped: boolean;
  name: string;
  mine: boolean;
  color?: string;
  reply: DecryptedMessage | null;
  replyName: string;
  editing: boolean;
  canEdit: boolean;
  canDelete: boolean;
  blocked: boolean;
  automod: boolean;
  mentioned: boolean;
  ctx: MentionContext;
  data?: ServerData;
  onReply: () => void;
  onReport: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (t: string) => Promise<void>;
  onDelete: (skipConfirm?: boolean) => void;
}) {
  const time = new Date(m.row.created_at);
  const trust = trustState(m.row.author_id);
  const author = getProfile(m.row.author_id);
  const translateMode = useSettings((s) => s.translateMode);
  const [reveal, setReveal] = useState(false);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const reportStatus = myReports.use((s) => s.byMessage[m.row.id]);
  const [forwarding, setForwarding] = useState(false);
  const text = m.payload?.text ?? '';
  const flagged = automod && !mine && containsSlur(text);

  useEffect(() => {
    if (translateMode !== 'auto' || mine || !text || !translationSupported()) return;
    let cancelled = false;
    translate(m.row.id, text)
      .then((t) => !cancelled && setTranslation(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [translateMode, mine, text, m.row.id]);

  async function doTranslate() {
    setTrError(null);
    try {
      const t = await translate(m.row.id, text);
      if (!t) setTrError('This message is already in your language.');
      setTranslation(t);
      setShowOriginal(false);
    } catch (e) {
      setTrError(errorMessage(e));
    }
  }

  const embeds = m.payload && !editing ? findEmbeds(text) : [];
  const bareGif = isBareGif(text);
  const shownText = translation && !showOriginal ? translation.text : text;

  function menu(e: React.MouseEvent) {
    const items: Entry[] = [
      m.payload && { label: 'Reply', icon: 'reply', onClick: onReply },
      canEdit && { label: 'Edit Message', icon: 'edit', onClick: onEdit },
      m.payload && { label: 'Forward', icon: 'share', onClick: () => setForwarding(true) },
      m.payload && text && { label: 'Copy Text', icon: 'copy', onClick: () => copyText(text) },
      m.payload &&
        text &&
        (translation
          ? { label: showOriginal ? 'Show Translation' : 'Show Original', icon: 'translate', onClick: () => setShowOriginal((v) => !v) }
          : { label: 'Translate', icon: 'translate', onClick: doTranslate }),
      bareGif && { label: 'Favorite GIF', icon: 'star', onClick: () => toggleGifFavorite({ id: text, url: text.trim(), preview: text.trim(), width: 1, height: 1 }) },
      { type: 'sep' },
      canDelete && { label: 'Delete Message', icon: 'trash', danger: true, hint: 'shift-click skips', onClick: () => onDelete(e.shiftKey) },
      { type: 'sep' },
      !mine && m.payload && !reportStatus && { label: 'Report Message', icon: 'flag', danger: true, onClick: onReport },
      {
        label: 'Copy Message Link',
        icon: 'link',
        onClick: () => copyText(linkTo(`channels/${data?.server?.id ?? '@me'}/${m.row.channel_id}/${m.row.id}`)),
      },
      { label: 'Copy Message ID', icon: 'copy', onClick: () => copyText(m.row.id) },
    ];
    openMenu(e, items);
  }

  if (blocked && !reveal) {
    return (
      <div className="message blocked-message">
        <Icon name="block" size={14} /> Message from someone you blocked.
        <button className="btn link" onClick={() => setReveal(true)}>
          Show
        </button>
      </div>
    );
  }

  return (
    <div id={`m-${m.row.id}`} className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}`} onContextMenu={menu}>
      {forwarding && m.payload && <ForwardModal m={m} onClose={() => setForwarding(false)} />}
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
          <button
            className="avatar-btn"
            onClick={() => openProfile(m.row.author_id, data?.server?.id)}
            onContextMenu={(e) => openMenu(e, userMenu(m.row.author_id, { data }))}
          >
            <Avatar profile={author} size={40} />
          </button>
        )}
        <div className="message-body">
          {!grouped && (
            <div className="message-meta">
              <button
                className="author"
                style={{ color }}
                onClick={() => openProfile(m.row.author_id, data?.server?.id)}
                onContextMenu={(e) => openMenu(e, userMenu(m.row.author_id, { data }))}
              >
                {name}
              </button>
              <Badges ids={author?.badges} max={4} size={15} />
              <ServerTag tag={author?.server_tag} />
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
              <Icon name="lock" size={14} /> Sent before you had this channel’s key. It unlocks when a member who has it comes online.
            </div>
          )}
          {m.error === 'invalid' && (
            <div className="undecryptable bad">
              <Icon name="warning" size={14} /> This message failed signature verification and was hidden.
            </div>
          )}
          {m.payload &&
            (editing ? (
              <EditBox initial={text} onCancel={onCancelEdit} onSave={onSaveEdit} />
            ) : flagged && !reveal ? (
              <div className="undecryptable">
                <Icon name="shield" size={14} /> Hidden by AutoMod.
                <button className="btn link" onClick={() => setReveal(true)}>
                  Show anyway
                </button>
              </div>
            ) : (
              <>
                {m.payload.forwarded && (
                  <div className="forwarded-label">
                    <Icon name="share" size={13} /> Forwarded from <b>{m.payload.forwarded.author}</b>
                  </div>
                )}
                {!bareGif && shownText && (
                  <div className="message-text">
                    <Markdown text={shownText} ctx={ctx} />
                    {m.row.edited_at && <span className="edited">(edited)</span>}
                    {reportStatus && (
                      <span className={`report-tag ${reportStatus}`}>
                        <Icon name="flag" size={11} /> Reported · {reportStatus === 'under_review' ? 'under review' : reportStatus === 'actioned' ? 'action taken' : 'reviewed'}
                      </span>
                    )}
                  </div>
                )}
                {translation && (
                  <div className="translated-note">
                    <Icon name="translate" size={12} />
                    {showOriginal ? 'Original' : `Translated from ${languageName(translation.from)}`} ·{' '}
                    <button className="btn link" onClick={() => setShowOriginal((v) => !v)}>
                      {showOriginal ? 'show translation' : 'show original'}
                    </button>
                  </div>
                )}
                {trError && <div className="translated-note">{trError}</div>}
              </>
            ))}
          {!flagged &&
            embeds.map((e) => (
              <div key={e.src} className="embed-wrap">
                <Embed e={e} />
                {e.kind === 'gif' && (
                  <button
                    className="gif-star embed-star"
                    title="Add to favorites"
                    onClick={() => toggleGifFavorite({ id: e.src, url: e.src, preview: e.src, width: 1, height: 1 })}
                  >
                    <Icon name="star" size={16} />
                  </button>
                )}
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
          {m.payload && (
            <button className="icon-btn" onClick={() => setForwarding(true)} title="Forward">
              <Icon name="share" size={16} />
            </button>
          )}
          {m.payload && text && !mine && (
            <button className="icon-btn" onClick={doTranslate} title="Translate">
              <Icon name="translate" size={16} />
            </button>
          )}
          {canEdit && (
            <button className="icon-btn" onClick={onEdit} title="Edit">
              <Icon name="edit" size={16} />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn danger-text" onClick={(e) => onDelete(e.shiftKey)} title="Delete (shift-click to skip confirmation)">
              <Icon name="trash" size={16} />
            </button>
          )}
          <button className="icon-btn" onClick={menu} title="More">
            <Icon name="more" size={16} />
          </button>
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

// --------------------------------------------------------------- composer --

interface Mentionables {
  people: { id: string; label: string; sub: string; profile: Profile }[];
  roles: { id: string; label: string; color: string }[];
  channels: { id: string; label: string }[];
  everyone: boolean;
}

type Suggestion = { key: string; insert: string; token: string; label: ReactNode; sub?: string };

function Composer({
  channelId,
  placeholder,
  disabled,
  replyTo,
  onCancelReply,
  onSend,
  mentionables,
  incoming,
  onIncomingTaken,
}: {
  channelId: string;
  placeholder: string;
  disabled: boolean;
  replyTo: string | null;
  onCancelReply: () => void;
  onSend: (text: string, files: File[], onProgress?: (fraction: number) => void) => Promise<void>;
  mentionables: Mentionables;
  /** files dropped onto the chat */
  incoming: File[];
  onIncomingTaken: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gifs, setGifs] = useState(false);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  // "@Name" shown in the box -> "<@id>" sent
  const tokens = useRef(new Map<string, string>());
  // caret position to restore right after the next render (keeps fast typing in order)
  const pendingCaret = useRef<number | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [fmt, setFmt] = useState<{ x: number; y: number } | null>(null);
  const sendTyping = useTypingSender(channelId);

  useEffect(() => {
    setText('');
    setFiles([]);
    setError(null);
    tokens.current = new Map();
  }, [channelId]);

  // grow with content
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
    const m = before.match(/(^|\s)([@#])([^\s@#]{0,32})$/);
    return m ? { trigger: m[2], q: m[3].toLowerCase(), start: caret - m[3].length - 1 } : null;
  }, [text, caret]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!query) return [];
    if (query.trigger === '#')
      return mentionables.channels
        .filter((c) => c.label.toLowerCase().includes(query.q))
        .slice(0, 8)
        .map((c) => ({ key: c.id, insert: `#${c.label}`, token: `<#${c.id}>`, label: <># {c.label}</> }));
    const out: Suggestion[] = mentionables.people
      .filter((p) => p.label.toLowerCase().includes(query.q) || p.sub.includes(query.q))
      .slice(0, 8)
      .map((p) => ({
        key: p.id,
        insert: `@${p.label}`,
        token: `<@${p.id}>`,
        label: (
          <>
            <Avatar profile={p.profile} size={22} /> {p.label}
          </>
        ),
        sub: p.sub,
      }));
    for (const r of mentionables.roles.filter((r) => r.label.toLowerCase().includes(query.q)).slice(0, 5))
      out.push({ key: r.id, insert: `@${r.label}`, token: `<@&${r.id}>`, label: <span style={{ color: r.color }}>@{r.label}</span>, sub: 'role' });
    if (mentionables.everyone)
      for (const w of ['everyone', 'here'])
        if (w.startsWith(query.q))
          out.push({ key: w, insert: `@${w}`, token: `@${w}`, label: `@${w}`, sub: w === 'everyone' ? 'Notify everyone in this channel' : 'Notify everyone online' });
    return out;
  }, [query, mentionables]);

  useEffect(() => setSel(0), [query?.q, query?.trigger]);

  /** Show the formatting bar above the selected text (double-click a word, or drag-select). */
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
      const sel = text.slice(a, b);
      // toggle off if it's already wrapped
      if (text.slice(a - marker.length, a) === marker && text.slice(b, b + marker.length) === marker) {
        setText(text.slice(0, a - marker.length) + sel + text.slice(b + marker.length));
        pendingSelection.current = [a - marker.length, b - marker.length];
        return;
      }
      setText(text.slice(0, a) + marker + sel + marker + text.slice(b));
      pendingSelection.current = [a + marker.length, b + marker.length];
      return;
    }
    // headings / small text apply to whole lines
    const lineStart = text.lastIndexOf('\n', a - 1) + 1;
    const nextBreak = text.indexOf('\n', b);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const prefix = marker + ' ';
    const allHave = lines.every((l) => l.startsWith(prefix));
    const next = lines.map((l) => {
      const bare = l.replace(/^(#{1,3}|-#) /, '');
      return allHave ? bare : prefix + bare;
    });
    const joined = next.join('\n');
    setText(text.slice(0, lineStart) + joined + text.slice(lineEnd));
    pendingSelection.current = [lineStart, lineStart + joined.length];
  }

  function pick(s: Suggestion) {
    if (!query) return;
    const before = text.slice(0, query.start);
    const after = text.slice(caret);
    const next = `${before}${s.insert} ${after}`;
    tokens.current.set(s.insert, s.token);
    pendingCaret.current = before.length + s.insert.length + 1;
    setText(next);
  }

  function encodeMentions(t: string): string {
    let out = t;
    // longest first so "@Sam Smith" wins over "@Sam"
    for (const [shown, token] of [...tokens.current.entries()].sort((a, b) => b[0].length - a[0].length)) out = out.split(shown).join(token);
    // typed @username without picking from the list
    out = out.replace(/(^|\s)@([a-z0-9_.]{2,32})\b/g, (all, pre: string, u: string) => {
      const p = mentionables.people.find((x) => x.sub === u);
      return p ? `${pre}<@${p.id}>` : all;
    });
    return out;
  }

  async function submit(raw = text, extraFiles: File[] = []) {
    const t = encodeMentions(raw.trim());
    const all = [...files, ...extraFiles];
    if ((!t && !all.length) || busy) return;
    setBusy(true);
    setError(null);
    try {
      setUpload(all.length ? 0 : null);
      await onSend(t, all, all.length ? setUpload : undefined);
      if (raw === text) {
        setText('');
        setFiles([]);
        tokens.current = new Map();
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
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= MAX_FILE)].slice(0, 10));
  }

  useEffect(() => {
    if (!incoming.length) return;
    addFiles(incoming);
    onIncomingTaken();
    textarea.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

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
              <Icon name="file" size={16} /> {f.name} <span className="muted small">{formatSize(f.size)}</span>
              <button className="icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {upload !== null && (
        <div className="upload-progress">
          <span>Encrypting and uploading… {Math.round(upload * 100)}%</span>
          <div className="att-progress">
            <span style={{ width: `${Math.round(upload * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {suggestions.length > 0 && (
        <div className="mention-pop" role="listbox">
          <div className="mention-pop-title">{query?.trigger === '#' ? 'Channels' : 'Members & roles'}</div>
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
            </button>
          ))}
        </div>
      )}
      {gifs && (
        <GifPicker
          onClose={() => setGifs(false)}
          onPick={(url) => submit(url)}
          onFile={(f) => submit('', [f])}
        />
      )}
      {fmt && !disabled && (
        <div className="fmt-bar" style={{ left: fmt.x, top: fmt.y }} onMouseDown={(e) => e.preventDefault()} role="toolbar" aria-label="Formatting">
          <button title="Bold (Ctrl+B)" onClick={() => applyFormat('wrap', '**')}>
            <b>B</b>
          </button>
          <button title="Italic (Ctrl+I)" onClick={() => applyFormat('wrap', '*')}>
            <i>I</i>
          </button>
          <button title="Underline (Ctrl+U)" onClick={() => applyFormat('wrap', '__')}>
            <u>U</u>
          </button>
          <button title="Strikethrough" onClick={() => applyFormat('wrap', '~~')}>
            <s>S</s>
          </button>
          <button title="Code" className="mono" onClick={() => applyFormat('wrap', '`')}>
            {'</>'}
          </button>
          <button title="Spoiler" onClick={() => applyFormat('wrap', '||')}>
            <Icon name="eyeOff" size={14} />
          </button>
          <span className="fmt-sep" />
          <button title="Big heading" onClick={() => applyFormat('line', '#')}>
            H1
          </button>
          <button title="Medium heading" onClick={() => applyFormat('line', '##')}>
            H2
          </button>
          <button title="Small heading" onClick={() => applyFormat('line', '###')}>
            H3
          </button>
          <button title="Small grey text" onClick={() => applyFormat('line', '-#')}>
            <small>-#</small>
          </button>
        </div>
      )}
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
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={textarea}
          rows={1}
          value={text}
          maxLength={MAX_TEXT}
          disabled={disabled || busy}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              sendTyping();
            }
          }}
          onSelect={(e) => {
            setCaret(e.currentTarget.selectionStart ?? 0);
            updateFmt();
          }}
          onBlur={() => setTimeout(() => document.activeElement !== textarea.current && setFmt(null), 150)}
          onScroll={() => setFmt(null)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) addFiles(pasted);
          }}
          onKeyDown={(e) => {
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
                setCaret(-1);
                return;
              }
            }
            if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase()) && e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) {
              e.preventDefault();
              applyFormat('wrap', { b: '**', i: '*', u: '__' }[e.key.toLowerCase() as 'b' | 'i' | 'u']);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              setFmt(null);
              submit();
            }
          }}
        />
        {busy ? (
          <div className="spinner small" />
        ) : (
          <>
            <button type="button" className="icon-btn gif-btn" disabled={disabled} onClick={() => setGifs((g) => !g)} title="GIFs">
              <Icon name="gif" />
            </button>
            <EmojiButton
              disabled={disabled}
              onPick={(emoji) => {
                const el = textarea.current;
                const at = el?.selectionStart ?? text.length;
                pendingCaret.current = at + emoji.length;
                setText((t) => t.slice(0, at) + emoji + t.slice(el?.selectionEnd ?? at));
              }}
            />
          </>
        )}
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
      if (uid && uid !== me && !socialStore.get().relations[uid]?.blocked) setTyping((t) => ({ ...t, [uid]: Date.now() }));
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

const EMOJI = [
  '😀', '😂', '🥲', '😊', '😍', '🥰', '😎', '🤔', '😴', '😭', '😤', '😳',
  '🙃', '😅', '🤯', '🥳', '😬', '🫠', '🙏', '👍', '👎', '👏', '🙌', '💪',
  '👀', '🔥', '✨', '💯', '❤️', '💜', '💙', '💚', '🎉', '🎮', '🎧', '🍕',
  '☕', '🌙', '⭐', '✅', '❌', '⚡', '💀', '🤝', '👋', '🫡', '🤷', '🔒',
];

function EmojiButton({ onPick, disabled }: { onPick: (e: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="emoji-wrap" ref={ref}>
      <button type="button" className="icon-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} title="Emoji">
        <Icon name="smile" />
      </button>
      {open && (
        <div className="emoji-pop" role="dialog" aria-label="Pick an emoji">
          {EMOJI.map((e) => (
            <button
              type="button"
              key={e}
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

// ---------------------------------------------------------------- forward --

interface Destination {
  id: string;
  label: string;
  sub: string;
}

function ForwardModal({ m, onClose }: { m: DecryptedMessage; onClose: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [dests, setDests] = useState<Destination[] | null>(null);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const out: Destination[] = [];
      const { data: parts } = await supabase.from('dm_participants').select('channel_id, user_id');
      const byChannel = new Map<string, string[]>();
      for (const p of parts ?? []) byChannel.set(p.channel_id, [...(byChannel.get(p.channel_id) ?? []), p.user_id]);
      const dmIds = [...byChannel.keys()];
      const { data: dmChans } = dmIds.length ? await supabase.from('channels').select('id, name, is_group').in('id', dmIds) : { data: [] };
      await loadProfiles([...byChannel.values()].flat());
      for (const c of (dmChans ?? []) as { id: string; name: string; is_group: boolean }[]) {
        const others = (byChannel.get(c.id) ?? []).filter((u) => u !== me.id);
        out.push({ id: c.id, label: c.is_group ? c.name : displayName(others[0] ?? ''), sub: c.is_group ? 'Group' : 'Direct message' });
      }
      const { data: mem } = await supabase.from('server_members').select('server_id').eq('user_id', me.id);
      const sids = (mem ?? []).map((x) => x.server_id);
      if (sids.length) {
        const [{ data: servers }, { data: chans }] = await Promise.all([
          supabase.from('servers').select('id, name').in('id', sids),
          supabase.from('channels').select('id, name, server_id, type').in('server_id', sids),
        ]);
        const sname = new Map(((servers ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
        for (const c of (chans ?? []) as { id: string; name: string; server_id: string; type: string }[])
          out.push({ id: c.id, label: c.type === 'voice' ? `🔊 ${c.name}` : `#${c.name}`, sub: sname.get(c.server_id) ?? 'Server' });
      }
      setDests(out);
    })();
  }, [me.id]);

  async function send(d: Destination) {
    setBusy(d.id);
    setError(null);
    try {
      const keyring = sessionStore.get().keyring!;
      await keyring.prepareSend(d.id);
      const attachments: Attachment[] = [];
      for (const a of m.payload?.attachments ?? []) attachments.push(await copyAttachment(a, d.id));
      const payload: MessagePayload = {
        v: 1,
        text: m.payload!.text,
        sentAt: Date.now(),
        forwarded: { author: displayName(m.row.author_id), at: m.row.created_at },
        ...(attachments.length ? { attachments } : {}),
      };
      for (const p of [payload, ...(note.trim() ? [{ v: 1 as const, text: note.trim(), sentAt: Date.now() + 1 }] : [])]) {
        const id = crypto.randomUUID();
        const env = await keyring.encrypt(d.id, id, p);
        const { error: err } = await supabase.from('messages').insert({
          id,
          channel_id: d.id,
          author_id: me.id,
          author_key_id: env.author_key_id,
          epoch: env.epoch,
          iv: env.iv,
          ciphertext: env.ciphertext,
          signature: env.signature,
        });
        if (err) throw err;
      }
      setDone((x) => [...x, d.id]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const list = (dests ?? []).filter((d) => !q || `${d.label} ${d.sub}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Forward message" onClose={onClose}>
      <div className="forward-preview">
        <b>{displayName(m.row.author_id)}</b>
        <span>{m.payload?.text.slice(0, 200) || `${m.payload?.attachments?.length ?? 0} file(s)`}</span>
      </div>
      <input className="search-input" autoFocus placeholder="Search conversations and channels" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="form-error">{error}</div>}
      <div className="forward-list">
        {!dests && <div className="spinner small" />}
        {list.map((d) => (
          <div key={d.id} className="forward-row">
            <div className="grow">
              <div>{d.label}</div>
              <div className="small muted">{d.sub}</div>
            </div>
            <button className="btn small primary" disabled={busy !== null || done.includes(d.id)} onClick={() => send(d)}>
              {done.includes(d.id) ? 'Sent' : busy === d.id ? 'Sending…' : 'Send'}
            </button>
          </div>
        ))}
      </div>
      <input placeholder="Add a message (optional)" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="small muted">Forwarded messages are re-encrypted for the new conversation.</p>
    </Modal>
  );
}
