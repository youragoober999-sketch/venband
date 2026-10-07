import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setMediaRemoved, useMediaRemoved } from '../lib/mediaBans';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import type { Attachment, MessagePayload } from '../lib/crypto';
import { copyAttachment, removeAttachment, uploadEncrypted } from '../lib/files';
import { AttachmentView } from './Attachments';
import { linkTo } from '../lib/router';
import { uiStore } from '../lib/ui';
import { Modal } from './ui';
import { requestKeys } from '../lib/presence';
import { displayName, getProfile, loadProfiles, trustState } from '../lib/directory';
import type { DecryptedMessage } from '../lib/keyring';
import type { Channel, MessageRow, Profile } from '../lib/types';
import { openChannel, useMessages, type ServerData } from '../hooks/data';
import { setUnread, setViewingChannel } from '../lib/notify';
import { socialStore } from '../lib/social';
import { getSettings, useSettings } from '../lib/settings';
import { fetchPreview, previewableLink } from '../lib/linkPreview';
import { inviteCodeFrom } from '../lib/dmSend';
import { InviteEmbed } from './Invite';
import { customEmoji, expressionStore } from '../lib/expressions';
import { languageName, translate, translationSupported, type Translation } from '../lib/translate';
import { containsSlur } from '../lib/automod';
import { has, P } from '../lib/permissions';
import { isSaved, loadSavedIds, setPinned, setSaved, useChannelExtras, type PollState, type ReactionGroup, type ThreadInfo } from '../lib/chatExtras';
import { Avatar, Icon, StyledName } from './ui';
import { Badges, OwnerCrown, RoleIcon } from './Badges';
import { copyText, openMenu, type Entry } from './ContextMenu';
import { askConfirm, askText } from './Dialogs';
import { loadMyReports, myReports, reportMessage } from '../lib/reports';
import { Embed, findEmbeds, isBareGif, Markdown, mentionsMe, type MentionContext } from './Markdown';
import { FavoriteStar, toggleGifFavorite } from './GifPicker';
import { openProfile, ServerTag, userMenu } from './People';
import { Composer, useTyping, type Mentionables, type PendingFile, type SendOptions } from './Composer';
import { EditHistoryModal, PollView, QuickReactBar, quickReactionSet, Reactions, ThreadSummary } from './MessageParts';
import { EmojiPicker } from './EmojiPicker';
import { toggleReaction } from '../lib/chatExtras';
import { useApps, useBotMessages, useServerCommands, type Application, type BotMessage } from '../lib/bots';
import { BotTag, PresetLogo } from './Apps';

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

/** Where you stopped reading this conversation (synced across your devices). */
function useReadMarker(channelId: string, latest: DecryptedMessage | undefined, active: boolean) {
  const me = sessionStore.use((s) => s.identity?.userId);
  // the marker as it was when you opened the conversation: the divider stays put until you leave
  const [openedAt, setOpenedAt] = useState<string | null | undefined>(undefined);
  const manual = useRef(false);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    setOpenedAt(undefined);
    manual.current = false;
    saved.current = null;
    if (!active) return;
    let cancelled = false;
    supabase
      .from('read_states')
      .select('last_read_at')
      .eq('channel_id', channelId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setOpenedAt((data?.last_read_at as string | undefined) ?? null));
    return () => {
      cancelled = true;
    };
  }, [channelId, active]);
  // you're looking at it: move the marker to the newest message (once loaded, never backwards)
  useEffect(() => {
    if (!active || openedAt === undefined || !latest || manual.current || !me) return;
    const at = latest.row.created_at;
    if (saved.current && saved.current >= at) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      saved.current = at;
      supabase.from('read_states').upsert({ user_id: me, channel_id: channelId, last_read_at: at, manual_unread: false, updated_at: new Date().toISOString() }).then(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [latest, openedAt, channelId, active, me]);
  const markUnread = useCallback(
    async (fromIso: string) => {
      if (!me) return;
      manual.current = true;
      const before = new Date(new Date(fromIso).getTime() - 1).toISOString();
      setOpenedAt(before);
      await supabase.from('read_states').upsert({ user_id: me, channel_id: channelId, last_read_at: before, manual_unread: true, updated_at: new Date().toISOString() });
    },
    [channelId, me],
  );
  return { openedAt, markUnread, manual };
}

export function ChatView({
  channel,
  title,
  canSend,
  canManage,
  headerExtra,
  data,
  dmMembers,
  threadRoot,
  thread,
  onCloseThread,
}: {
  channel: Channel;
  title: string;
  canSend: boolean;
  canManage: boolean;
  headerExtra?: ReactNode;
  data?: ServerData;
  /** other people in a DM / group (for @mentions) */
  dmMembers?: Profile[];
  /** show one thread instead of the channel */
  threadRoot?: string;
  thread?: ThreadInfo;
  onCloseThread?: () => void;
}) {
  const { messages, hasMore, loadOlder, keyStatus, upsertLocal, removeLocal } = useMessages(channel, threadRoot ?? null);
  const identity = sessionStore.use((s) => s.identity)!;
  const me = sessionStore.use((s) => s.me)!;
  const relations = socialStore.use((s) => s.relations);
  const showJoins = useSettings((s) => s.chat.showJoins);
  const isThread = Boolean(threadRoot);
  const isWelcome = !isThread && Boolean(data?.server?.welcome_channel_id && data.server.welcome_channel_id === channel.id);
  const joins = useJoinEvents(isWelcome && showJoins ? (data?.server?.id ?? null) : null);
  const botMessages = useBotMessages(data && !isThread ? channel.id : null);
  const botApps = useApps(botMessages.map((b) => b.app_id));
  const botCommands = useServerCommands(!isThread ? (data?.server?.id ?? null) : null);
  const [replyTo, setReplyTo] = useState<DecryptedMessage | null>(null);
  const [quote, setQuote] = useState<DecryptedMessage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'pins' | 'threads'>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const composerKey = threadRoot ? `${channel.id}:${threadRoot}` : channel.id;
  const typingAt = useTyping(composerKey);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const byId = useMemo(() => new Map(messages.map((m) => [m.row.id, m])), [messages]);
  const ids = useMemo(() => messages.map((m) => m.row.id), [messages]);
  const extras = useChannelExtras(channel.id, ids, threadRoot ? `:t${threadRoot.slice(0, 8)}` : '');
  const automod = Boolean(data?.server?.automod?.slurs);
  const myRoleIds = data?.rolesOf(me.id).map((r) => r.id) ?? [];
  const chanPerms = data ? data.permsFor(channel.id) : 0;
  const can = (bit: number) => !data || has(chanPerms, bit);
  const isDm = channel.type === 'dm';
  const canPin = isDm || can(P.MANAGE_MESSAGES);
  const { openedAt, markUnread, manual } = useReadMarker(channel.id, messages[messages.length - 1], !isThread);
  const pinnedIds = useMemo(() => new Set(extras.pins.map((p) => p.message_id)), [extras.pins]);
  const [, bumpSaved] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, joins, botMessages]);

  useEffect(() => {
    loadMyReports();
    loadSavedIds().then(() => bumpSaved((x) => x + 1));
  }, []);

  // opened from a message link: load back until it's here, scroll to it, flash it
  const jump = uiStore.use((s) => s.jump);
  const jumpTries = useRef(0);
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(`m-${jump}`);
    if (!el) {
      if (isThread || jumpTries.current > 25) return;
      // maybe it's in a thread, or further back
      if (jumpTries.current === 0) {
        supabase
          .from('messages')
          .select('id, thread_root')
          .eq('id', jump)
          .maybeSingle()
          .then(({ data: row }) => {
            if (!row) {
              uiStore.set({ jump: null });
              alert('That message was deleted, or you don’t have permission to view it.');
            } else if (row.thread_root) setOpenThread(row.thread_root);
          });
      }
      if (hasMore && keyStatus !== 'loading') {
        jumpTries.current++;
        stick.current = false;
        loadOlder();
      }
      return;
    }
    jumpTries.current = 0;
    stick.current = false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2400);
    uiStore.set({ jump: null });
  }, [jump, messages, hasMore, keyStatus, loadOlder, isThread]);

  useEffect(() => {
    stick.current = true;
    setReplyTo(null);
    setQuote(null);
    setEditing(null);
    setOpenThread(null);
    if (isThread) return;
    setViewingChannel(channel.id);
    return () => setViewingChannel(null);
  }, [channel.id, isThread]);

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

  async function buildPayload(text: string, files: PendingFile[], onProgress?: (f: number) => void, poll?: SendOptions['poll']): Promise<MessagePayload> {
    const attachments: Attachment[] = [];
    const totalBytes = files.reduce((n, f) => n + f.file.size, 0) || 1;
    let doneBytes = 0;
    for (const f of files) {
      const a = await uploadEncrypted(channel.id, f.file, (p) => onProgress?.((doneBytes + p * f.file.size) / totalBytes));
      attachments.push({ ...a, ...(f.spoiler ? { spoiler: true } : {}), ...(f.alt ? { alt: f.alt } : {}) });
      doneBytes += f.file.size;
    }
    const link = getSettings().chat.linkPreviews && !poll ? previewableLink(text) : null;
    const preview = link ? await fetchPreview(link) : null;
    return {
      v: 1,
      text,
      sentAt: Date.now(),
      ...(preview ? { preview } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(poll ? { poll: { question: poll.question, options: poll.options, multi: poll.multi, anonymous: poll.anonymous, expiresAt: poll.hours ? Date.now() + poll.hours * 3_600_000 : null } } : {}),
      ...(quote?.payload ? { quote: { id: quote.row.id, author: nameOf(quote.row.author_id), text: quote.payload.text.slice(0, 300), channel: channel.id } } : {}),
    };
  }

  async function sendPayload(text: string, files: PendingFile[], opts: SendOptions) {
    const slash = !files.length && !opts.scheduleAt && text.trim().match(/^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i);
    const command = slash && botCommands.find((c) => c.name === slash[1].toLowerCase());
    if (slash && command) {
      // commands go to the bot in plain text (bots can't read encrypted messages)
      const { error } = await supabase.rpc('use_bot_command', { p_channel: channel.id, p_app: command.app_id, p_command: command.name, p_args: slash[2] ?? '' });
      if (error) throw error;
      return;
    }
    if (automod && containsSlur(text)) throw new Error('AutoMod blocked this message: it contains a slur this server doesn’t allow.');
    if (files.length && !can(P.ATTACH_FILES)) throw new Error('You can’t upload files here: your roles don’t have the “Attach Files” permission.');
    if (opts.poll && !can(P.CREATE_POLLS)) throw new Error('You can’t post polls here: your roles don’t have the “Create Polls” permission.');
    if (/(^|[^\w`])@(everyone|here)\b/.test(text) && data && !can(P.MENTION_EVERYONE)) throw new Error('You can’t mention @everyone or @here in this server.');
    const keyring = sessionStore.get().keyring!;
    await keyring.prepareSend(channel.id);
    const payload = await buildPayload(text, files, opts.onProgress, opts.poll);
    if (opts.scheduleAt) {
      const times = opts.repeat ? opts.repeat.times : 1;
      const step = opts.repeat?.every === 'week' ? 7 * 86_400_000 : 86_400_000;
      for (let i = 0; i < times; i++) {
        const id = crypto.randomUUID();
        const env = await keyring.encrypt(channel.id, id, { ...payload, sentAt: opts.scheduleAt + i * step });
        const { error } = await supabase.from('scheduled_messages').insert({
          id,
          channel_id: channel.id,
          author_id: identity.userId,
          author_key_id: env.author_key_id,
          epoch: env.epoch,
          iv: env.iv,
          ciphertext: env.ciphertext,
          signature: env.signature,
          reply_to: replyTo?.row.id ?? null,
          send_at: new Date(opts.scheduleAt + i * step).toISOString(),
        });
        if (error) throw error;
      }
      setReplyTo(null);
      setQuote(null);
      return;
    }
    const id = crypto.randomUUID();
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
      ...(threadRoot ? { thread_root: threadRoot } : {}),
    };
    const { error } = await supabase.from('messages').insert(row);
    if (error) throw error;
    if (opts.poll) {
      const { error: pe } = await supabase.from('polls').insert({
        message_id: id,
        channel_id: channel.id,
        option_count: opts.poll.options.length,
        multi: opts.poll.multi,
        anonymous: opts.poll.anonymous,
        expires_at: opts.poll.hours ? new Date(Date.now() + opts.poll.hours * 3_600_000).toISOString() : null,
      });
      if (pe) throw pe;
    }
    stick.current = true;
    upsertLocal({ ...row, created_at: new Date().toISOString(), edited_at: null } as MessageRow);
    setReplyTo(null);
    setQuote(null);
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

  async function createThread(m: DecryptedMessage) {
    const existing = extras.threads[m.row.id];
    if (existing) return setOpenThread(m.row.id);
    const name = await askText({ title: 'Create thread', label: 'Thread name', initial: (m.payload?.text ?? '').replace(/\s+/g, ' ').slice(0, 60) || 'New thread', maxLength: 100 });
    if (!name?.trim()) return;
    const { error } = await supabase.from('threads').insert({ root_id: m.row.id, channel_id: channel.id, name: name.trim() });
    if (error) return alert(errorMessage(error));
    await extras.reloadThreads();
    setOpenThread(m.row.id);
  }

  const timeline = useMemo(() => {
    const items: ({ kind: 'msg'; m: DecryptedMessage; at: string } | { kind: 'join'; e: JoinEvent; at: string } | { kind: 'bot'; b: BotMessage; at: string })[] = messages.map((m) => ({
      kind: 'msg' as const,
      m,
      at: m.row.created_at,
    }));
    const oldest = messages[0]?.row.created_at;
    for (const e of joins) if (!hasMore || !oldest || e.created_at >= oldest) items.push({ kind: 'join', e, at: e.created_at });
    for (const b of botMessages) if (!hasMore || !oldest || b.created_at >= oldest) items.push({ kind: 'bot', b, at: b.created_at });
    return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [messages, joins, botMessages, hasMore]);

  // first unread message (from someone else) when you opened the conversation
  const firstUnread = useMemo(() => {
    if (!openedAt) return null;
    return messages.find((m) => m.row.created_at > openedAt && m.row.author_id !== me.id)?.row.id ?? null;
  }, [messages, openedAt, me.id]);

  const expressions = expressionStore.use((s) => s.list);
  const mentionables: Mentionables = useMemo(() => {
    const people: Profile[] = data
      ? (data.members.map((m) => getProfile(m.user_id)).filter(Boolean) as Profile[])
      : [me, ...(dmMembers ?? [])];
    return {
      people: people.map((p) => ({ id: p.id, label: nameOf(p.id), sub: p.username, profile: p })),
      roles: (data?.roles ?? []).filter((r) => !r.is_default).map((r) => ({ id: r.id, label: r.name, color: r.color })),
      channels: (data?.channels ?? []).filter((c) => c.type === 'text').map((c) => ({ id: c.id, label: c.name })),
      everyone: Boolean(data) && can(P.MENTION_EVERYONE),
      emoji: customEmoji(expressions),
      commands: botCommands,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dmMembers, me, expressions, botCommands]);

  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');
  const threadInfo = openThread ? extras.threads[openThread] : undefined;
  const threadRootMsg = threadRoot ? null : openThread ? byId.get(openThread) : null;
  const canThreadManage = can(P.MANAGE_THREADS) || (thread && thread.created_by === me.id);

  const threadHeader = isThread && thread && (
    <>
      {canThreadManage && (
        <button
          className="icon-btn"
          title="Rename thread"
          onClick={async () => {
            const name = await askText({ title: 'Rename thread', label: 'Name', initial: thread.name, maxLength: 100 });
            if (name?.trim()) supabase.from('threads').update({ name: name.trim() }).eq('root_id', thread.root_id).then(({ error }) => error && alert(errorMessage(error)));
          }}
        >
          <Icon name="edit" size={16} />
        </button>
      )}
      {can(P.MANAGE_THREADS) && (
        <button
          className={`icon-btn${thread.locked ? ' on' : ''}`}
          title={thread.locked ? 'Unlock thread' : 'Lock thread (only moderators can post)'}
          onClick={() => supabase.from('threads').update({ locked: !thread.locked }).eq('root_id', thread.root_id).then(({ error }) => error && alert(errorMessage(error)))}
        >
          <Icon name={thread.locked ? 'lockOpen' : 'lock'} size={16} />
        </button>
      )}
      {canThreadManage && (
        <button
          className={`icon-btn${thread.archived ? ' on' : ''}`}
          title={thread.archived ? 'Unarchive' : 'Archive thread'}
          onClick={() => supabase.from('threads').update({ archived: !thread.archived }).eq('root_id', thread.root_id).then(({ error }) => error && alert(errorMessage(error)))}
        >
          <Icon name="archive" size={16} />
        </button>
      )}
      {can(P.MANAGE_THREADS) && (
        <button
          className="icon-btn danger-text"
          title="Delete thread"
          onClick={async () => {
            if (!(await askConfirm({ title: 'Delete thread', body: `Delete “${thread.name}”? Replies in it are deleted too.`, confirm: 'Delete', danger: true }))) return;
            const { error } = await supabase.from('messages').delete().eq('thread_root', thread.root_id);
            const { error: e2 } = error ? { error } : await supabase.from('threads').delete().eq('root_id', thread.root_id);
            if (e2) alert(errorMessage(e2));
            else onCloseThread?.();
          }}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
      <button className="icon-btn" onClick={onCloseThread} title="Close thread" aria-label="Close thread">
        <Icon name="x" />
      </button>
    </>
  );

  const threadLocked = Boolean(isThread && thread?.locked && !can(P.MANAGE_THREADS));

  return (
    <div className={`chat-with-panel${openThread || panel ? ' has-panel' : ''}`}>
      <div
        className={`chat${isThread ? ' thread-chat' : ''}`}
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
              <b>Drop to send to {isDm ? title : `#${title}`}</b>
              <span className="small muted">Up to 10 files, 5 GB each. Encrypted on your device before upload. You can mark them as spoilers before sending.</span>
            </div>
          </div>
        )}
        <header className="chat-header">
          <Icon name={isThread ? 'thread' : isDm ? 'message' : 'hash'} />
          <h3>{isThread ? (thread?.name ?? title) : title}</h3>
          <span className="lock-hint" title="End-to-end encrypted: only people in this conversation can read it.">
            <Icon name="lock" size={13} />
          </span>
          {!isThread && channel.topic && (
            <span className="topic">
              <Markdown text={channel.topic} ctx={mentionCtx} />
            </span>
          )}
          {isThread && thread && (
            <span className="topic small muted">
              {thread.locked ? 'Locked · ' : ''}
              {thread.archived ? 'Archived · ' : ''}
              {thread.message_count} replies
            </span>
          )}
          <div className="chat-header-actions">
            {!isThread && !isDm && (
              <button className={`icon-btn${panel === 'threads' ? ' on' : ''}`} title="Threads" aria-label="Threads" onClick={() => setPanel(panel === 'threads' ? null : 'threads')}>
                <Icon name="thread" />
              </button>
            )}
            {!isThread && (
              <button className={`icon-btn${panel === 'pins' ? ' on' : ''}`} title="Pinned messages" aria-label="Pinned messages" onClick={() => setPanel(panel === 'pins' ? null : 'pins')}>
                <Icon name="pin" />
                {extras.pins.length > 0 && <span className="icon-badge">{extras.pins.length}</span>}
              </button>
            )}
            {isThread ? threadHeader : headerExtra}
          </div>
        </header>
        <div
          className="messages"
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label={`Messages in ${title}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (el.scrollTop < 200 && hasMore && keyStatus !== 'loading' && messages.length) {
              // infinite scroll upwards
              stick.current = false;
              loadOlder();
            }
          }}
        >
          {keyStatus === 'loading' && !messages.length && <MessageSkeleton />}
          {hasMore && (
            <button className="btn link load-older" onClick={() => ((stick.current = false), loadOlder())}>
              Load older messages
            </button>
          )}
          {!hasMore && !isThread && (
            <div className="channel-intro">
              <div className="channel-intro-icon">
                <Icon name={isWelcome ? 'hand' : isDm ? 'message' : 'hash'} size={36} />
              </div>
              <h1>{isWelcome ? `Welcome to ${data?.server?.name}` : isDm ? title : `#${title}`}</h1>
              <p className="muted">
                {isWelcome
                  ? 'This is the beginning of the server. New members are announced here.'
                  : isDm
                    ? `This is the start of your conversation with ${title}.`
                    : `This is the start of #${title}.`}{' '}
                Only the people in here can read it.
              </p>
            </div>
          )}
          {isThread && threadRoot && <ThreadRootPreview id={threadRoot} channel={channel} ctx={mentionCtx} />}
          {timeline.map((item, i) => {
            const prevItem = timeline[i - 1];
            const newDay = !prevItem || new Date(prevItem.at).toDateString() !== new Date(item.at).toDateString();
            const divider = newDay && (
              <div className="day-divider">
                <span>{new Date(item.at).toLocaleDateString(undefined, { dateStyle: 'long' })}</span>
              </div>
            );
            if (item.kind === 'bot')
              return (
                <Fragment key={item.b.id}>
                  {divider}
                  <BotMessageItem b={item.b} app={botApps[item.b.app_id]} ctx={mentionCtx} canManage={canManage} />
                </Fragment>
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
            const unreadHere = firstUnread === m.row.id;
            const grouped =
              prev &&
              !unreadHere &&
              prev.row.author_id === m.row.author_id &&
              !m.row.reply_to &&
              new Date(m.row.created_at).getTime() - new Date(prev.row.created_at).getTime() < 5 * 60_000;
            const mine = m.row.author_id === identity.userId;
            return (
              <Fragment key={m.row.id}>
                {divider}
                {unreadHere && (
                  <div className="unread-divider" role="separator" aria-label="New messages">
                    <span>New</span>
                  </div>
                )}
                <MessageItem
                  m={m}
                  grouped={Boolean(grouped) && !newDay}
                  name={nameOf(m.row.author_id)}
                  mine={mine}
                  color={colorOf(m.row.author_id)}
                  serverOwner={!isDm && data?.server?.owner_id === m.row.author_id}
                  groupOwner={Boolean(channel.is_group) && channel.owner_id === m.row.author_id}
                  reply={m.row.reply_to ? byId.get(m.row.reply_to) ?? null : null}
                  replyName={m.row.reply_to && byId.get(m.row.reply_to) ? nameOf(byId.get(m.row.reply_to)!.row.author_id) : ''}
                  editing={editing === m.row.id}
                  canEdit={mine && Boolean(m.payload) && !m.payload?.poll}
                  canDelete={mine || canManage}
                  blocked={!mine && Boolean(relations[m.row.author_id]?.blocked)}
                  automod={automod}
                  mentioned={!mine && Boolean(m.payload) && mentionsMe(m.payload!.text, me.id, myRoleIds, !isDm)}
                  ctx={mentionCtx}
                  data={data}
                  reactions={extras.reactions[m.row.id] ?? []}
                  canReact={can(P.ADD_REACTIONS) && canSend}
                  pinned={pinnedIds.has(m.row.id)}
                  canPin={canPin}
                  thread={isThread ? undefined : extras.threads[m.row.id]}
                  canThread={!isThread && !isDm && can(P.CREATE_THREADS)}
                  poll={extras.polls[m.row.id]}
                  channelId={channel.id}
                  serverId={channel.server_id ?? null}
                  onOpenThread={() => setOpenThread(m.row.id)}
                  onCreateThread={() => createThread(m)}
                  onQuote={() => setQuote(m)}
                  onMarkUnread={() => {
                    markUnread(m.row.created_at);
                    const n = messages.filter((x) => x.row.created_at >= m.row.created_at && x.row.author_id !== me.id).length;
                    setUnread(channel.id, channel.server_id ?? null, Math.max(1, n));
                  }}
                  onReply={() => setReplyTo(m)}
                  onEdit={() => setEditing(m.row.id)}
                  onCancelEdit={() => setEditing(null)}
                  onSaveEdit={(t) => saveEdit(m, t)}
                  onDelete={(skip) => remove(m, skip)}
                  onReport={async () => {
                    const reason = await askText({
                      title: 'Report message',
                      label: 'What’s wrong with it?',
                      placeholder: 'Harassment, spam, threats, phishing…',
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
          {manual.current && <div className="small muted unread-note">Marked as unread. It stays unread until you leave this conversation.</div>}
        </div>
        <div className="typing" aria-live="polite">
          {typing.length > 0 && (
            <>
              <span className="typing-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {`${typing.map((u) => nameOf(u)).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`}
            </>
          )}
        </div>
        <Composer
          channelId={composerKey}
          placeholder={
            threadLocked
              ? 'This thread is locked'
              : canSend
                ? isThread
                  ? `Reply in ${thread?.name ?? 'thread'}`
                  : `Message ${isDm ? '@' + title : '#' + title}`
                : 'You don’t have permission to send messages here'
          }
          disabled={!canSend || keyStatus === 'loading' || threadLocked}
          replyTo={replyTo ? nameOf(replyTo.row.author_id) : null}
          quote={quote?.payload ? { author: nameOf(quote.row.author_id), text: quote.payload.text } : null}
          onCancelReply={() => setReplyTo(null)}
          onCancelQuote={() => setQuote(null)}
          onQuoteDrop={(id) => {
            const m = byId.get(id);
            if (m?.payload) setQuote(m);
          }}
          onSend={sendPayload}
          mentionables={mentionables}
          incoming={dropped}
          onIncomingTaken={() => setDropped([])}
          canPoll={can(P.CREATE_POLLS)}
          canAttach={can(P.ATTACH_FILES)}
          canSchedule={!isThread}
          canRepeat={isDm || can(P.MANAGE_MESSAGES)}
        />
      </div>
      {openThread && !isThread && (
        <aside className="side-panel thread-panel" aria-label="Thread">
          <ChatView
            channel={channel}
            title={threadInfo?.name ?? 'Thread'}
            canSend={canSend && !threadInfo?.archived}
            canManage={canManage}
            data={data}
            dmMembers={dmMembers}
            threadRoot={openThread}
            thread={threadInfo}
            onCloseThread={() => setOpenThread(null)}
          />
          {!threadRootMsg && null}
        </aside>
      )}
      {panel === 'pins' && !openThread && (
        <PinnedPanel channel={channel} pins={extras.pins} onClose={() => setPanel(null)} canUnpin={canPin} nameOf={nameOf} ctx={mentionCtx} serverId={data?.server?.id ?? null} />
      )}
      {panel === 'threads' && !openThread && (
        <ThreadsPanel
          threads={Object.values(extras.threads)}
          onOpen={(id) => {
            setPanel(null);
            setOpenThread(id);
          }}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

/** Site name, title and description of a link (made by the sender, shown from the encrypted message). */
function LinkPreviewCard({ p }: { p: NonNullable<MessagePayload['preview']> }) {
  const [imgOk, setImgOk] = useState(true);
  let host = '';
  try {
    host = new URL(p.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return (
    <div className="link-preview" style={p.themeColor ? { borderLeftColor: p.themeColor } : undefined}>
      <div className="grow link-preview-text">
        <div className="link-preview-site">{p.siteName || host}</div>
        {p.title && (
          <a className="link-preview-title" href={p.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            {p.title}
          </a>
        )}
        {p.description && <div className="link-preview-desc">{p.description}</div>}
      </div>
      {p.image && imgOk && <img className="link-preview-img" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />}
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="msg-skeleton" aria-label="Loading messages" role="status">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="msg-skel-row">
          <span className="skel skel-avatar" />
          <div className="grow">
            <span className="skel skel-line short" />
            <span className="skel skel-line" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadRootPreview({ id, channel, ctx }: { id: string; channel: Channel; ctx: MentionContext }) {
  const [m, setM] = useState<DecryptedMessage | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('messages').select('*').eq('id', id).maybeSingle();
      if (!data) return;
      await loadProfiles([data.author_id]);
      setM(await sessionStore.get().keyring!.decrypt(data as MessageRow));
    })();
  }, [id, channel.id]);
  if (!m) return null;
  return (
    <div className="thread-root">
      <Avatar profile={getProfile(m.row.author_id)} size={32} />
      <div className="grow">
        <div className="small">
          <b>{displayName(m.row.author_id)}</b> <span className="muted">{friendlyTime(new Date(m.row.created_at))}</span>
        </div>
        {m.payload ? <Markdown text={m.payload.text || (m.payload.attachments?.length ? '📎 file' : '')} ctx={ctx} /> : <i className="muted">Can’t decrypt</i>}
      </div>
    </div>
  );
}

function PinnedPanel({
  channel,
  pins,
  onClose,
  canUnpin,
  nameOf,
  ctx,
  serverId,
}: {
  channel: Channel;
  pins: { message_id: string; pinned_at: string; pinned_by: string }[];
  onClose: () => void;
  canUnpin: boolean;
  nameOf: (id: string) => string;
  ctx: MentionContext;
  serverId: string | null;
}) {
  const [items, setItems] = useState<DecryptedMessage[] | null>(null);
  const key = pins.map((p) => p.message_id).join(',');
  useEffect(() => {
    (async () => {
      if (!pins.length) return setItems([]);
      const { data } = await supabase.from('messages').select('*').in('id', pins.map((p) => p.message_id));
      const rows = (data ?? []) as MessageRow[];
      await loadProfiles(rows.map((r) => r.author_id));
      const kr = sessionStore.get().keyring!;
      const dec = await Promise.all(rows.map((r) => kr.decrypt(r)));
      const order = new Map(pins.map((p, i) => [p.message_id, i]));
      setItems(dec.sort((a, b) => (order.get(a.row.id) ?? 0) - (order.get(b.row.id) ?? 0)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, channel.id]);
  return (
    <aside className="side-panel" aria-label="Pinned messages">
      <header className="side-panel-head">
        <Icon name="pin" size={18} />
        <h3>Pinned messages</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      <div className="side-panel-body">
        {!items && <MessageSkeleton />}
        {items?.length === 0 && (
          <div className="empty-panel">
            <Icon name="pin" size={36} />
            <p>No pinned messages yet.</p>
            <p className="small muted">Right-click a message and choose Pin Message to keep it here.</p>
          </div>
        )}
        {items?.map((m) => (
          <div key={m.row.id} className="panel-message">
            <div className="small">
              <b>{nameOf(m.row.author_id)}</b> <span className="muted">{friendlyTime(new Date(m.row.created_at))}</span>
            </div>
            <div className="panel-message-text">{m.payload ? <Markdown text={m.payload.text || `📎 ${m.payload.attachments?.length ?? 0} file(s)`} ctx={ctx} /> : <i className="muted">Can’t decrypt yet</i>}</div>
            <div className="panel-message-actions">
              <button className="btn small secondary" onClick={() => (openChannel(serverId ?? '@me', channel.id), uiStore.set({ jump: m.row.id }))}>
                Jump
              </button>
              {canUnpin && (
                <button className="btn link small" onClick={() => setPinned(m.row, false).catch((e) => alert(errorMessage(e)))}>
                  Unpin
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ThreadsPanel({ threads, onOpen, onClose }: { threads: ThreadInfo[]; onOpen: (id: string) => void; onClose: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const list = threads.filter((t) => showArchived || !t.archived).sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
  return (
    <aside className="side-panel" aria-label="Threads">
      <header className="side-panel-head">
        <Icon name="thread" size={18} />
        <h3>Threads</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      <div className="side-panel-body">
        <label className="check-row small">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived threads
        </label>
        {!list.length && (
          <div className="empty-panel">
            <Icon name="thread" size={36} />
            <p>No threads yet.</p>
            <p className="small muted">Hover a message and press the thread button to start a side conversation without flooding the channel.</p>
          </div>
        )}
        {list.map((t) => (
          <ThreadSummary key={t.root_id} t={t} onOpen={() => onOpen(t.root_id)} />
        ))}
      </div>
    </aside>
  );
}

function MessageItem({
  m,
  grouped,
  name,
  mine,
  color,
  serverOwner,
  groupOwner,
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
  reactions,
  canReact,
  pinned,
  canPin,
  thread,
  canThread,
  poll,
  channelId,
  serverId,
  onOpenThread,
  onCreateThread,
  onQuote,
  onMarkUnread,
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
  serverOwner: boolean;
  groupOwner: boolean;
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
  reactions: ReactionGroup[];
  canReact: boolean;
  pinned: boolean;
  canPin: boolean;
  thread?: ThreadInfo;
  canThread: boolean;
  poll?: PollState;
  channelId: string;
  serverId: string | null;
  onOpenThread: () => void;
  onCreateThread: () => void;
  onQuote: () => void;
  onMarkUnread: () => void;
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
  const iconRole = data?.rolesOf(m.row.author_id).find((r) => r.icon) ?? null;
  const translateMode = useSettings((s) => s.translateMode);
  const recent = useSettings((s) => s.recentReactions);
  const gifFavs = useSettings((s) => s.gifFavorites);
  const clock24 = useSettings((s) => s.chat.clock24);
  const [reveal, setReveal] = useState(false);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [keyAsked, setKeyAsked] = useState(false);
  const reportStatus = myReports.use((s) => s.byMessage[m.row.id]);
  const [forwarding, setForwarding] = useState(false);
  const [saved, setSavedState] = useState(isSaved(m.row.id));
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
  const invites = useMemo(() => {
    const out: { code: string; voice: string | null }[] = [];
    for (const word of text.split(/\s+/)) {
      const code = inviteCodeFrom(word);
      if (code && !out.some((x) => x.code === code)) out.push({ code, voice: word.match(/[?&]voice=([0-9a-f-]{36})/)?.[1] ?? null });
      if (out.length >= 2) break;
    }
    return out;
  }, [text]);
  const bareGif = isBareGif(text);
  const gifUrls = embeds.filter((e) => e.kind === 'gif').map((e) => e.src);
  const identity = sessionStore.use((s) => s.identity)!;
  const isStaff = sessionStore.use((s) => ['moderator', 'admin', 'owner'].includes(s.me?.platform_role ?? 'user'));
  const shownText = translation && !showOriginal ? translation.text : text;
  const link = linkTo(`channels/${data?.server?.id ?? '@me'}/${m.row.channel_id}/${m.row.id}`);
  const react = (emoji: string) => toggleReaction(m.row, emoji, reactions.find((g) => g.emoji === emoji)?.mine ?? null).catch((e) => alert(errorMessage(e)));


  function menu(e: React.MouseEvent) {
    const anchor = e.currentTarget as HTMLElement;
    const items: Entry[] = [
      m.payload &&
        canReact && {
          type: 'custom',
          render: (close) => (
            <div className="ctx-reactions">
              {quickReactionSet(recent).map((em) => (
                <button key={em} className={reactions.find((g) => g.emoji === em)?.mine ? 'on' : ''} onClick={() => (close(), react(em))} title={`React with ${em}`}>
                  {em}
                </button>
              ))}
            </div>
          ),
        },
      m.payload && canReact && { label: 'Add Reaction', icon: 'smilePlus', onClick: () => setPicker(anchor) },
      m.payload && { type: 'sep' },
      m.payload && { label: 'Reply', icon: 'reply', onClick: onReply },
      m.payload && { label: 'Quote', icon: 'quote', onClick: onQuote },
      canEdit && { label: 'Edit Message', icon: 'edit', onClick: onEdit },
      m.row.edited_at && { label: 'View Edit History', icon: 'history', onClick: () => setHistory(true) },
      m.payload && { label: 'Forward', icon: 'share', onClick: () => setForwarding(true) },
      canThread && m.payload && { label: thread ? 'Open Thread' : 'Create Thread', icon: 'thread', onClick: thread ? onOpenThread : onCreateThread },
      canPin && m.payload && { label: pinned ? 'Unpin Message' : 'Pin Message', icon: 'pin', onClick: () => setPinned(m.row, !pinned).catch((err) => alert(errorMessage(err))) },
      m.payload && {
        label: saved ? 'Remove from Saved' : 'Save Message',
        icon: 'bookmark',
        onClick: () =>
          setSaved(m.row, !saved)
            .then(() => setSavedState(!saved))
            .catch((err) => alert(errorMessage(err))),
      },
      !mine && { label: 'Mark Unread', icon: 'unread', onClick: onMarkUnread },
      m.payload && text && { label: 'Copy Text', icon: 'copy', onClick: () => copyText(text) },
      m.payload &&
        text &&
        (translation
          ? { label: showOriginal ? 'Show Translation' : 'Show Original', icon: 'translate', onClick: () => setShowOriginal((v) => !v) }
          : { label: 'Translate', icon: 'translate', onClick: doTranslate }),
      bareGif && {
        label: gifFavs.some((f) => f.url === text.trim()) ? 'Remove from Favorites' : 'Favorite GIF',
        icon: 'star',
        onClick: () => toggleGifFavorite({ id: text, url: text.trim(), preview: text.trim(), width: 1, height: 1 }),
      },
      ...gifUrls.flatMap((url) => [
        data?.server &&
          (data.server.owner_id === identity.userId || has(data.myPermissions, P.ADMINISTRATOR)) && {
            label: 'Remove GIF from Server',
            icon: 'block',
            danger: true,
            hint: 'everyone sees a notice instead',
            onClick: () => setMediaRemoved(url, data.server!.id, true).catch((err) => alert(errorMessage(err))),
          },
        isStaff && {
          label: 'Remove GIF Everywhere',
          icon: 'block',
          danger: true,
          hint: 'Venband staff',
          onClick: () => setMediaRemoved(url, null, true).catch((err) => alert(errorMessage(err))),
        },
      ]),
      { type: 'sep' },
      { label: 'Copy Message Link', icon: 'link', onClick: () => copyText(link) },
      { label: 'Copy Message ID', icon: 'copy', onClick: () => copyText(m.row.id) },
      { type: 'sep' },
      canDelete && { label: 'Delete Message', icon: 'trash', danger: true, hint: 'shift-click skips', onClick: () => onDelete(e.shiftKey) },
      !mine && m.payload && !reportStatus && { label: 'Report Message', icon: 'flag', danger: true, onClick: onReport },
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

  const timeLabel = time.toLocaleTimeString(undefined, { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 });

  return (
    <div
      id={`m-${m.row.id}`}
      className={`message${grouped ? ' grouped' : ''}${mentioned ? ' mentioned' : ''}${pinned ? ' pinned' : ''}`}
      onContextMenu={menu}
      aria-label={`${name}, ${time.toLocaleString()}`}
    >
      {forwarding && m.payload && <ForwardModal m={m} onClose={() => setForwarding(false)} />}
      {history && <EditHistoryModal row={m.row} current={text} ctx={ctx} onClose={() => setHistory(false)} />}
      {picker && (
        <EmojiPicker
          anchor={picker}
          title="Add reaction"
          onClose={() => setPicker(null)}
          onPick={(p) => {
            setPicker(null);
            if (p.kind === 'unicode') react(p.char);
          }}
        />
      )}
      {m.row.reply_to && (
        <button className="reply-ref" onClick={() => uiStore.set({ jump: m.row.reply_to })} title="Jump to the original message">
          <Icon name="reply" size={14} />
          {reply ? (
            <>
              <b>{replyName}</b> <span>{reply.payload?.text.slice(0, 120) ?? '…'}</span>
            </>
          ) : (
            <span className="muted">Original message not loaded — click to find it</span>
          )}
        </button>
      )}
      <div className="message-row">
        {grouped ? (
          <span className="hover-time">{timeLabel}</span>
        ) : (
          <button
            className="avatar-btn"
            onClick={() => openProfile(m.row.author_id, data?.server?.id)}
            onContextMenu={(e) => openMenu(e, userMenu(m.row.author_id, { data }))}
            aria-label={`${name}'s profile`}
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
                {iconRole && <RoleIcon icon={iconRole.icon} size={15} />}
                <StyledName style={author?.name_style} fallbackColor={color}>
                  {name}
                </StyledName>
              </button>
              {serverOwner && <OwnerCrown size={15} label="Server owner" />}
              {groupOwner && <OwnerCrown size={15} label="Group owner" />}
              <Badges ids={author?.badges} max={4} size={15} />
              <ServerTag tag={author?.server_tag} serverId={author?.tag_server_id} />
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
                {friendlyTime(time, clock24)}
              </time>
              {pinned && (
                <span className="pinned-tag" title="Pinned">
                  <Icon name="pin" size={12} />
                </span>
              )}
            </div>
          )}
          {m.error === 'missing-key' && (
            <div className="undecryptable">
              <Icon name="lock" size={14} /> Sent before you had this conversation’s key.
              {keyAsked ? (
                <span className="muted small"> Requested — it unlocks automatically the moment someone who has it is online.</span>
              ) : (
                <button
                  className="btn link"
                  onClick={() => {
                    setKeyAsked(true);
                    requestKeys(serverId ?? channelId, channelId);
                    setTimeout(() => setKeyAsked(false), 6_000);
                  }}
                >
                  Ask for the key
                </button>
              )}
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
                {m.payload.quote && (
                  <button className="quote-block" onClick={() => uiStore.set({ jump: m.payload!.quote!.id })} title="Jump to the quoted message">
                    <b>{m.payload.quote.author}</b>
                    <span>{m.payload.quote.text}</span>
                  </button>
                )}
                {!bareGif && shownText && (
                  <div className="message-text">
                    <Markdown text={shownText} ctx={ctx} />
                    {m.row.edited_at && (
                      <button className="edited" onClick={() => setHistory(true)} title={`Edited ${new Date(m.row.edited_at).toLocaleString()} — click to see earlier versions`}>
                        (edited)
                      </button>
                    )}
                    {reportStatus && (
                      <span className={`report-tag ${reportStatus}`}>
                        <Icon name="flag" size={11} /> Reported · {reportStatus === 'under_review' ? 'under review' : reportStatus === 'actioned' ? 'action taken' : 'reviewed'}
                      </span>
                    )}
                  </div>
                )}
                {m.payload.poll && <PollView row={m.row} poll={m.payload.poll} state={poll} ctx={ctx} />}
                {m.payload.preview && <LinkPreviewCard p={m.payload.preview} />}
                {invites.map((c) => (
                  <InviteEmbed key={c.code} code={c.code} voice={c.voice} />
                ))}
                {[...new Set([...text.matchAll(/\/join-group\/([A-Za-z0-9]{10})\b/g)].map((x) => x[1]))].slice(0, 3).map((code) => (
                  <GroupInviteEmbed key={code} code={code} />
                ))}
                {translation && (
                  <div className="translated-note">
                    <Icon name="translate" size={12} />
                    {showOriginal ? 'Original' : `Translated from ${languageName(translation.from)}${translation.engine === 'phrasebook' ? ' (phrasebook)' : ''}`} ·{' '}
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
              <GifGuard key={e.src} url={e.src} active={e.kind === 'gif'} serverId={data?.server?.id ?? null}>
                <div className="embed-wrap">
                  <Embed e={e} />
                  {e.kind === 'gif' && <FavoriteStar className="embed-star" g={{ id: e.src, url: e.src, preview: e.src, width: 1, height: 1 }} fav={gifFavs.some((f) => f.url === e.src)} />}
                </div>
              </GifGuard>
            ))}
          {m.payload?.attachments?.map((a) => <AttachmentView key={a.path} a={a} />)}
          {reactions.length > 0 && <Reactions row={m.row} groups={reactions} canReact={canReact} />}
          {thread && <ThreadSummary t={thread} onOpen={onOpenThread} />}
        </div>
        <div className="message-actions" role="toolbar" aria-label="Message actions">
          {m.payload && canReact && <QuickReactBar row={m.row} groups={reactions} compact onMore={(el) => setPicker(el)} />}
          {m.payload && (
            <button className="icon-btn" onClick={onReply} title="Reply" aria-label="Reply">
              <Icon name="reply" size={16} />
            </button>
          )}
          {canThread && m.payload && (
            <button className="icon-btn" onClick={thread ? onOpenThread : onCreateThread} title={thread ? 'Open thread' : 'Create thread'} aria-label="Thread">
              <Icon name="thread" size={16} />
            </button>
          )}
          {m.payload && (
            <button className="icon-btn" onClick={() => setForwarding(true)} title="Forward" aria-label="Forward">
              <Icon name="share" size={16} />
            </button>
          )}
          {canEdit && (
            <button className="icon-btn" onClick={onEdit} title="Edit" aria-label="Edit">
              <Icon name="edit" size={16} />
            </button>
          )}
          {m.payload && (
            <span
              className="icon-btn drag-grip"
              draggable
              title="Drag into the message box to quote"
              aria-hidden
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-venband-message', m.row.id);
                e.dataTransfer.setData('text/plain', text);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Icon name="quote" size={15} />
            </span>
          )}
          <button className="icon-btn" onClick={menu} title="More" aria-label="More actions">
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
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
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

export function friendlyTime(d: Date, clock24 = false): string {
  const clock = d.toLocaleTimeString(undefined, { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Today at ${clock}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${clock}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${clock}`;
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

/** A bot's post: plain text (not end-to-end encrypted) with an optional embed. */
function BotMessageItem({ b, app, ctx, canManage }: { b: BotMessage; app?: Application; ctx: MentionContext; canManage: boolean }) {
  return (
    <div
      className="message bot-message"
      onContextMenu={(e) =>
        openMenu(e, [
          { type: 'header', label: app?.name ?? 'Bot' },
          { label: 'Copy Text', icon: 'copy', onClick: () => navigator.clipboard.writeText(b.content) },
          ...(canManage ? [{ label: 'Delete Message', icon: 'trash', danger: true, onClick: () => supabase.from('bot_messages').delete().eq('id', b.id).then(() => {}) }] : []),
        ])
      }
    >
      <span className="bot-avatar">{app ? <PresetLogo preset={app.preset} color={app.color} size={40} /> : <Icon name="bot" size={22} />}</span>
      <div className="message-body">
        <div className="message-head">
          <span className="author">{b.username ?? app?.name ?? 'Bot'}</span>
          <BotTag />
          <time dateTime={b.created_at}>{friendlyTime(new Date(b.created_at))}</time>
          <span className="bot-plain" title="Bots can’t use end-to-end encryption, so this message is stored as plain text.">
            <Icon name="unlock" size={12} />
          </span>
        </div>
        {b.content && (
          <div className="message-text">
            <Markdown text={b.content} ctx={ctx} />
          </div>
        )}
        {b.embed && (
          <div className="bot-embed" style={{ borderColor: b.embed.color ?? app?.color }}>
            {b.embed.title &&
              (b.embed.url ? (
                <a className="bot-embed-title" href={b.embed.url} target="_blank" rel="noopener noreferrer nofollow">
                  {b.embed.title}
                </a>
              ) : (
                <div className="bot-embed-title">{b.embed.title}</div>
              ))}
            {b.embed.description && (
              <div className="small">
                <Markdown text={b.embed.description} ctx={ctx} />
              </div>
            )}
            {b.embed.fields && (
              <div className="bot-embed-fields">
                {b.embed.fields.map((f, i) => (
                  <div key={i}>
                    <b className="small">{f.name}</b>
                    <div className="small">{f.value}</div>
                  </div>
                ))}
              </div>
            )}
            {b.embed.footer && <div className="small muted">{b.embed.footer}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Shows the removal notice instead of a GIF that was taken down. */
function GifGuard({ url, active, serverId, children }: { url: string; active: boolean; serverId: string | null; children: ReactNode }) {
  const removed = useMediaRemoved(active ? url : '', serverId);
  if (!active || !removed) return <>{children}</>;
  return (
    <div className="gif-removed" role="note">
      <Icon name="block" size={16} />
      <span>
        This GIF has been removed, probably because it didn’t follow{' '}
        <a href="https://www.venband.com/tos#gifs" target="_blank" rel="noopener noreferrer">
          https://www.venband.com/tos
        </a>
      </span>
    </div>
  );
}

/** A group chat invite link in a message. */
function GroupInviteEmbed({ code }: { code: string }) {
  const [g, setG] = useState<{ channel_id: string; name: string; members: number; joined: boolean } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc('group_invite_preview', { p_code: code }).then(({ data }) => setG(((data ?? []) as NonNullable<typeof g>[])[0] ?? null));
  }, [code]);
  if (g === undefined) return null;
  return (
    <div className="invite-embed">
      <div className="invite-embed-label">You’ve been invited to a group chat</div>
      <div className="invite-embed-row">
        <span className="invite-icon" style={{ width: 50, height: 50, background: 'var(--accent)' }}>
          <Icon name="users" size={22} />
        </span>
        <div className="grow invite-embed-text">
          <b className="ellipsis">{g ? g.name : 'This invite has expired'}</b>
          {g && <div className="small muted">{g.members} / 15 people · end-to-end encrypted</div>}
        </div>
        {g && (
          <button
            className={`btn ${g.joined ? 'secondary' : 'success'}`}
            onClick={async () => {
              if (g.joined) return openChannel('@me', g.channel_id);
              const { data, error } = await supabase.rpc('join_group', { p_code: code });
              if (error) return setError(errorMessage(error));
              openChannel('@me', data as string);
            }}
          >
            {g.joined ? 'Open' : 'Join'}
          </button>
        )}
      </div>
      {error && <div className="small danger-text">{error}</div>}
    </div>
  );
}
