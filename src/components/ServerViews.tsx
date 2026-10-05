// Server screens beyond plain chat: the welcome screen (rules + onboarding),
// forum channels and stage channels.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { has, P } from '../lib/permissions';
import { joinCall } from '../lib/call';
import type { MessagePayload } from '../lib/crypto';
import type { Channel } from '../lib/types';
import { openChannel, type ServerData } from '../hooks/data';
import { useActiveCall } from './Shell';
import { ChatView } from './Chat';
import { VoiceView } from './Voice';
import { Markdown } from './Markdown';
import { askText } from './Dialogs';
import { Avatar, Field, Icon, Modal } from './ui';
import type { ThreadInfo } from '../lib/chatExtras';
import { voogleVerify } from '../lib/voogle';

// ---------------------------------------------------------------- welcome --

export function WelcomeScreen({ data, onDone, onLater }: { data: ServerData; onDone: () => void; onLater: () => void }) {
  const s = data.server!;
  const rules = s.rules ?? [];
  const questions = s.onboarding?.questions ?? [];
  const [agree, setAgree] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('complete_onboarding', {
      p_server: s.id,
      p_accept_rules: agree || !rules.length,
      p_answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.map(String)])),
    });
    setBusy(false);
    if (e) return setError(errorMessage(e));
    onDone();
  }

  return (
    <Modal title={`Welcome to ${s.name}`} onClose={onLater} wide>
      <div className="welcome-screen">
        {(s.banner_url || s.icon_url) && (
          <div className="welcome-hero" style={s.banner_url ? { backgroundImage: `url(${s.banner_url})` } : { background: s.banner_color ?? s.icon_color }}>
            {s.icon_url && <img src={s.icon_url} alt="" />}
          </div>
        )}
        {s.welcome?.message && (
          <div className="welcome-message">
            <Markdown text={s.welcome.message} />
          </div>
        )}
        {(s.welcome?.buttons ?? []).length > 0 && (
          <div className="welcome-buttons">
            {s.welcome!.buttons!.map((b, i) => (
              <button
                key={i}
                className="welcome-button"
                onClick={() => {
                  openChannel(s.id, b.channel_id);
                  onLater();
                }}
              >
                <span>{b.emoji || '💬'}</span>
                <b>{b.label}</b>
                <span className="small muted">#{data.channels.find((c) => c.id === b.channel_id)?.name}</span>
              </button>
            ))}
          </div>
        )}
        {questions.map((q, qi) => (
          <div key={qi} className="welcome-question">
            <h3>{q.title}</h3>
            <div className="chip-row">
              {q.options.map((o, oi) => {
                const on = (answers[qi] ?? []).includes(oi);
                return (
                  <button
                    key={oi}
                    className={`chip big${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setAnswers((a) => {
                        const cur = a[qi] ?? [];
                        return { ...a, [qi]: on ? cur.filter((x) => x !== oi) : q.multi ? [...cur, oi] : [oi] };
                      })
                    }
                  >
                    {o.emoji} {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {rules.length > 0 && (
          <div className="welcome-rules">
            <h3>Server rules</h3>
            <ol>
              {rules.map((r, i) => (
                <li key={i}>
                  <Markdown text={r} />
                </li>
              ))}
            </ol>
            <label className="check-row">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I’ve read and agree to the rules
            </label>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {!rules.length && (
            <button className="btn secondary" onClick={onLater}>
              Skip
            </button>
          )}
          {rules.length > 0 && (
            <button className="btn secondary" onClick={onLater}>
              Look around first (read-only)
            </button>
          )}
          <button className="btn primary" disabled={busy || (rules.length > 0 && !agree)} onClick={finish}>
            {busy ? 'Finishing…' : rules.length ? 'Agree and start chatting' : 'Finish'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- forums --

export function ForumView({ channel, data }: { channel: Channel; data: ServerData }) {
  const me = sessionStore.use((s) => s.me)!;
  const [posts, setPosts] = useState<(ThreadInfo & { tags: string[]; pinned: boolean; solved: boolean; preview?: string; author?: string })[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'activity' | 'created'>(channel.settings?.sort === 'created' ? 'created' : 'activity');
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [composing, setComposing] = useState(false);
  const tags = channel.settings?.tags ?? [];
  const canPost = has(data.myPermissions, P.CREATE_THREADS) && has(data.myPermissions, P.SEND_MESSAGES);
  const canManage = has(data.myPermissions, P.MANAGE_THREADS);

  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('threads').select('*').eq('channel_id', channel.id).limit(300);
    const list = (rows ?? []) as (ThreadInfo & { tags: string[]; pinned: boolean; solved: boolean })[];
    // first lines of each post (decrypted here)
    const kr = sessionStore.get().keyring!;
    const { data: roots } = list.length ? await supabase.from('messages').select('*').in('id', list.map((p) => p.root_id)) : { data: [] };
    await kr.loadChannel(channel.id).catch(() => {});
    const preview = new Map<string, { text: string; author: string }>();
    for (const r of (roots ?? []) as Parameters<typeof kr.decrypt>[0][]) {
      const d = await kr.decrypt(r);
      preview.set(r.id, { text: (d.payload?.text ?? '').replace(/^\*\*.*?\*\*\n?/, '').slice(0, 220), author: r.author_id });
    }
    await loadProfiles([...preview.values()].map((p) => p.author));
    setPosts(list.map((p) => ({ ...p, preview: preview.get(p.root_id)?.text, author: preview.get(p.root_id)?.author })));
  }, [channel.id]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`dbc:${channel.id}:forum`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads', filter: `channel_id=eq.${channel.id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channel.id, load]);

  const shown = useMemo(() => {
    let l = (posts ?? []).filter((p) => !p.archived || p.pinned);
    if (tag) l = l.filter((p) => p.tags.includes(tag));
    if (q) l = l.filter((p) => `${p.name} ${p.preview ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    return l.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === 'created' ? (a.created_at < b.created_at ? 1 : -1) : a.last_message_at < b.last_message_at ? 1 : -1));
  }, [posts, tag, q, sort]);

  const openPost = posts?.find((p) => p.root_id === open);
  if (open && openPost)
    return (
      <div className="forum-post-view">
        <ChatView
          channel={channel}
          title={openPost.name}
          canSend={has(data.myPermissions, P.SEND_MESSAGES)}
          canManage={has(data.myPermissions, P.MANAGE_MESSAGES)}
          data={data}
          threadRoot={openPost.root_id}
          thread={openPost}
          onCloseThread={() => setOpen(null)}
        />
      </div>
    );

  return (
    <div className="forum-view">
      <header className="chat-header">
        <Icon name="thread" />
        <h3>{channel.name}</h3>
        {channel.topic && <span className="topic small muted">{channel.topic}</span>}
        <div className="chat-header-actions">
          {canManage && (
            <button
              className="btn small secondary"
              onClick={async () => {
                const v = await askText({ title: 'Forum tags', label: 'Tags, separated by commas', initial: tags.join(', '), maxLength: 300 });
                if (v === null) return;
                const next = v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
                await supabase.from('channels').update({ settings: { ...(channel.settings ?? {}), tags: next } }).eq('id', channel.id);
                data.reload();
              }}
            >
              Edit tags
            </button>
          )}
          {canPost && (
            <button className="btn small primary" onClick={() => setComposing(true)}>
              <Icon name="plus" size={14} /> New Post
            </button>
          )}
        </div>
      </header>
      <div className="forum-toolbar">
        <input className="search-input" placeholder="Search posts" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chip-row">
          <button className={`chip${!tag ? ' on' : ''}`} onClick={() => setTag(null)}>
            All
          </button>
          {tags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="forum-sort">
          <button className={sort === 'activity' ? 'on' : ''} onClick={() => setSort('activity')}>
            Recent activity
          </button>
          <button className={sort === 'created' ? 'on' : ''} onClick={() => setSort('created')}>
            Newest
          </button>
        </div>
      </div>
      <div className="forum-list">
        {!posts && <div className="spinner" />}
        {posts && !shown.length && (
          <div className="empty-panel">
            <Icon name="thread" size={40} />
            <p>No posts yet.</p>
            {canPost && <p className="small muted">Start the first discussion with New Post.</p>}
          </div>
        )}
        {shown.map((p) => (
          <div key={p.root_id} className={`forum-card${p.pinned ? ' pinned' : ''}`} role="button" tabIndex={0} onClick={() => setOpen(p.root_id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.root_id)}>
            <div className="forum-card-top">
              {p.pinned && <span className="forum-flag">📌 Pinned</span>}
              {p.solved && <span className="forum-flag solved">✓ Solved</span>}
              {p.locked && <span className="forum-flag">🔒</span>}
              {p.tags.map((t) => (
                <span key={t} className="chip small">
                  {t}
                </span>
              ))}
            </div>
            <h3>{p.name}</h3>
            {p.preview && <p className="small muted forum-preview">{p.preview}</p>}
            <div className="forum-card-foot small muted">
              {p.author && <Avatar profile={getProfile(p.author)} size={18} />}
              {p.author && displayName(p.author)}
              <span>· {p.message_count} repl{p.message_count === 1 ? 'y' : 'ies'}</span>
              <span>· {new Date(p.last_message_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
              {(canManage || p.created_by === me.id) && (
                <span className="forum-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn link small" onClick={() => supabase.from('threads').update({ solved: !p.solved }).eq('root_id', p.root_id).then(load)}>
                    {p.solved ? 'Unsolve' : 'Mark solved'}
                  </button>
                  {canManage && (
                    <button className="btn link small" onClick={() => supabase.from('threads').update({ pinned: !p.pinned }).eq('root_id', p.root_id).then(load)}>
                      {p.pinned ? 'Unpin' : 'Pin'}
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {composing && <NewPostModal channel={channel} tags={tags} onClose={() => setComposing(false)} onPosted={(id) => (setComposing(false), load().then(() => setOpen(id)))} />}
    </div>
  );
}

function NewPostModal({ channel, tags, onClose, onPosted }: { channel: Channel; tags: string[]; onClose: () => void; onPosted: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function post() {
    setBusy(true);
    setError(null);
    try {
      const { keyring, identity } = sessionStore.get();
      await keyring!.prepareSend(channel.id);
      const id = crypto.randomUUID();
      const payload: MessagePayload = { v: 1, text: `**${title.trim()}**\n${body.trim()}`, sentAt: Date.now() };
      const env = await keyring!.encrypt(channel.id, id, payload);
      const { error: e1 } = await supabase.from('messages').insert({ id, channel_id: channel.id, author_id: identity!.userId, author_key_id: env.author_key_id, epoch: env.epoch, iv: env.iv, ciphertext: env.ciphertext, signature: env.signature });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('threads').insert({ root_id: id, channel_id: channel.id, name: title.trim().slice(0, 100) });
      if (e2) throw e2;
      if (picked.length) await supabase.from('threads').update({ tags: picked }).eq('root_id', id);
      onPosted(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New post" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <Field label="Title">
        <input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Message">
        <textarea rows={6} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {tags.length > 0 && (
        <Field label="Tags" hint="up to 5">
          <div className="chip-row">
            {tags.map((t) => (
              <button key={t} type="button" className={`chip${picked.includes(t) ? ' on' : ''}`} onClick={() => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t].slice(0, 5)))}>
                {t}
              </button>
            ))}
          </div>
        </Field>
      )}
      <p className="small muted">Posts are end-to-end encrypted like every message. The title is visible in the post list.</p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !title.trim()} onClick={post}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- stages --

type StageRow = { user_id: string; state: 'speaker' | 'requested' | 'invited' };

export function StageView({ channel, data }: { channel: Channel; data: ServerData }) {
  const me = sessionStore.use((s) => s.me)!;
  const identity = sessionStore.use((s) => s.identity)!;
  const call = useActiveCall();
  const inThis = call?.channelId === channel.id;
  const [rows, setRows] = useState<StageRow[]>([]);
  const isMod = has(data.myPermissions, P.MUTE_MEMBERS);
  const load = useCallback(async () => {
    const { data: r } = await supabase.from('stage_members').select('user_id, state').eq('channel_id', channel.id);
    setRows((r ?? []) as StageRow[]);
    loadProfiles(((r ?? []) as StageRow[]).map((x) => x.user_id));
  }, [channel.id]);
  useEffect(() => {
    load();
    const ch = supabase
      .channel(`dbc:${channel.id}:stage`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_members', filter: `channel_id=eq.${channel.id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channel.id, load]);
  const mine = rows.find((r) => r.user_id === me.id);
  const speaking = isMod || mine?.state === 'speaker';
  // the audience stays muted until a moderator brings them on stage
  useEffect(() => {
    if (!inThis || !call) return;
    call.setMuteLock(speaking ? null : 'You’re in the audience. Raise your hand to ask to speak.');
  }, [inThis, call, speaking]);

  const set = (userId: string, state: StageRow['state'] | null) =>
    (state ? supabase.from('stage_members').upsert({ channel_id: channel.id, user_id: userId, state, updated_at: new Date().toISOString() }) : supabase.from('stage_members').delete().eq('channel_id', channel.id).eq('user_id', userId)).then(({ error }) => {
      if (error) alert(errorMessage(error));
      load();
    });

  const requests = rows.filter((r) => r.state === 'requested');
  const speakers = rows.filter((r) => r.state === 'speaker');
  if (!inThis)
    return (
      <div className="empty-state voice-lobby stage-lobby">
        <Icon name="stage" size={64} />
        <h2>{channel.name}</h2>
        {channel.topic && <p className="muted">{channel.topic}</p>}
        <p className="muted">
          {speakers.length} speaker{speakers.length === 1 ? '' : 's'} on stage
        </p>
        <button className="btn primary" disabled={!has(data.myPermissions, P.CONNECT)} onClick={() => joinCall(identity, channel.id, data.server!.id, channel.name)}>
          Join as {isMod ? 'moderator' : 'audience'}
        </button>
      </div>
    );
  return (
    <div className="stage-view">
      <div className="stage-bar">
        <Icon name="stage" />
        <b>{channel.name}</b>
        {channel.topic && <span className="small muted">{channel.topic}</span>}
        <span className="grow" />
        {!speaking && mine?.state !== 'requested' && has(data.myPermissions, P.REQUEST_TO_SPEAK) && (
          <button className="btn small primary" onClick={() => set(me.id, 'requested')}>
            ✋ Raise hand
          </button>
        )}
        {mine?.state === 'requested' && (
          <button className="btn small secondary" onClick={() => set(me.id, null)}>
            Lower hand
          </button>
        )}
        {mine?.state === 'invited' && (
          <button className="btn small success" onClick={() => set(me.id, 'speaker')}>
            Accept invite to speak
          </button>
        )}
        {mine?.state === 'speaker' && !isMod && (
          <button className="btn small secondary" onClick={() => set(me.id, null)}>
            Move to audience
          </button>
        )}
      </div>
      <VoiceView data={data} />
      {isMod && (
        <div className="stage-mod">
          <h4>Requests to speak ({requests.length})</h4>
          {!requests.length && <p className="small muted">No hands raised.</p>}
          {requests.map((r) => (
            <div key={r.user_id} className="invite-friend">
              <Avatar profile={getProfile(r.user_id)} size={28} />
              <span className="grow">{displayName(r.user_id)}</span>
              <button className="btn small success" onClick={() => set(r.user_id, 'speaker')}>
                Bring on stage
              </button>
              <button className="btn small secondary" onClick={() => set(r.user_id, null)}>
                Dismiss
              </button>
            </div>
          ))}
          <h4>On stage</h4>
          {speakers.map((r) => (
            <div key={r.user_id} className="invite-friend">
              <Avatar profile={getProfile(r.user_id)} size={28} />
              <span className="grow">{displayName(r.user_id)}</span>
              <button className="btn small secondary" onClick={() => set(r.user_id, null)}>
                Move to audience
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Verify with Voogle" bar for servers that require it, until you pass. */
export function VoogleGate({ data }: { data: ServerData }) {
  const server = data.server!;
  const [state, setState] = useState<{ result: string; reason?: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const exempt = has(data.myPermissions, P.MANAGE_SERVER) || has(data.myPermissions, P.KICK_MEMBERS) || has(data.myPermissions, P.BAN_MEMBERS) || has(data.myPermissions, P.MODERATE_MEMBERS);
  useEffect(() => {
    supabase
      .from('voogle_verifications')
      .select('result, reason')
      .eq('server_id', server.id)
      .eq('user_id', sessionStore.get().identity!.userId)
      .maybeSingle()
      .then(({ data: row }) => setState((row as { result: string; reason: string } | null) ?? null));
  }, [server.id]);
  if (exempt || state === undefined || state?.result === 'passed') return null;
  return (
    <div className={`voogle-gate ${state?.result ?? 'todo'}`}>
      <Icon name="shield" size={18} />
      <span className="grow">
        {state?.result === 'review'
          ? 'Thanks! A moderator will check your verification shortly.'
          : state?.result === 'blocked'
            ? `Verification didn’t pass. ${state.reason ?? ''}`
            : `${server.name} uses Voogle to keep alt accounts out. Verify to start talking — it takes a second and never shares your IP.`}
      </span>
      {state?.result !== 'review' && (
        <button
          className="btn success small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await voogleVerify(server.id);
              setState(r);
              if (r.result === 'passed') data.reload();
            } catch (e) {
              setState({ result: 'blocked', reason: errorMessage(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Checking…' : state ? 'Try again' : 'Verify'}
        </button>
      )}
    </div>
  );
}

/** "You're timed out" bar for the current server. */
export function TimeoutBar({ data }: { data: ServerData }) {
  const me = sessionStore.use((s) => s.identity?.userId);
  const member = data.members.find((m) => m.user_id === me);
  const [, tick] = useState(0);
  const until = member?.timeout_until ? new Date(member.timeout_until) : null;
  useEffect(() => {
    if (!until || until <= new Date()) return;
    const t = setTimeout(() => (tick((x) => x + 1), data.reload()), Math.min(until.getTime() - Date.now() + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [until?.getTime()]);
  if (!until || until <= new Date()) return null;
  return (
    <div className="voogle-gate blocked timeout-bar">
      <Icon name="clock" size={18} />
      <span className="grow">
        You’re timed out until {until.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. You can read but not talk.
        {member?.timeout_reason ? ` Reason: “${member.timeout_reason}”` : ''}
      </span>
    </div>
  );
}

interface Warning {
  id: string;
  server_id: string;
  reason: string;
  created_at: string;
}

/** Pops up warnings from server moderators until you acknowledge them. */
export function WarningsNotice() {
  const me = sessionStore.use((s) => s.identity?.userId);
  const [list, setList] = useState<(Warning & { server_name?: string })[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('member_warnings').select('id, server_id, reason, created_at').eq('user_id', me!).is('acknowledged_at', null).order('created_at');
    const rows = (data ?? []) as Warning[];
    const { data: servers } = rows.length ? await supabase.from('servers').select('id, name').in('id', [...new Set(rows.map((r) => r.server_id))]) : { data: [] };
    const names = new Map((servers ?? []).map((s) => [s.id as string, s.name as string]));
    setList(rows.map((r) => ({ ...r, server_name: names.get(r.server_id) })));
  }, [me]);
  useEffect(() => {
    if (!me) return;
    load();
    const ch = supabase
      .channel(`dbu:${me}:warnings`, { config: { private: true } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_warnings', filter: `user_id=eq.${me}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me, load]);
  const w = list[0];
  if (!w) return null;
  const ack = async () => {
    await supabase.rpc('ack_warning', { p_warning: w.id });
    setList((l) => l.slice(1));
  };
  return (
    <Modal title="You received a warning" onClose={ack}>
      <div className="warning-card">
        <Icon name="warning" size={28} />
        <div>
          <div className="small muted">From the moderators of {w.server_name ?? 'a server'} · {new Date(w.created_at).toLocaleString()}</div>
          <p className="warning-reason">{w.reason}</p>
          <p className="small muted">Please follow the server’s rules. More warnings can lead to a timeout, kick or ban.</p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={ack}>
          I understand
        </button>
      </div>
    </Modal>
  );
}
