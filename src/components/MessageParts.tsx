// Pieces shown on and around a message: reactions, the quick-react bar,
// polls, edit history and thread summaries.
import { useEffect, useRef, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, loadProfiles } from '../lib/directory';
import { QUICK_REACTIONS, nameOfEmoji, loadEmoji } from '../lib/emoji';
import { toggleReaction, votePoll, type PollState, type ReactionGroup, type ThreadInfo } from '../lib/chatExtras';
import { useSettings } from '../lib/settings';
import type { MessagePayload } from '../lib/crypto';
import type { MessageRow } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';
import { Markdown, type MentionContext } from './Markdown';
import { Icon, Modal } from './ui';

/** Quick reactions plus my two most recent (no duplicates). */
export function quickReactionSet(recent: string[]): string[] {
  const extra = recent.filter((e) => !QUICK_REACTIONS.includes(e)).slice(0, 2);
  return [...QUICK_REACTIONS, ...extra];
}

export function Reactions({ row, groups, canReact }: { row: MessageRow; groups: ReactionGroup[]; canReact: boolean }) {
  const [picking, setPicking] = useState(false);
  const add = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (groups.length) loadProfiles(groups.flatMap((g) => g.users).slice(0, 100));
  }, [groups]);
  if (!groups.length) return null;
  const toggle = (emoji: string, mine: string | null) => {
    setError(null);
    toggleReaction(row, emoji, mine).catch((e) => setError(errorMessage(e)));
  };
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {groups.map((g) => {
        const names = g.users.slice(0, 12).map((u) => displayName(u));
        const who = names.join(', ') + (g.users.length > 12 ? ` and ${g.users.length - 12} more` : '');
        return (
          <button
            key={g.emoji}
            type="button"
            className={`reaction${g.mine ? ' mine' : ''}`}
            title={`${who} reacted with :${nameOfEmoji(g.emoji)}:`}
            aria-pressed={Boolean(g.mine)}
            aria-label={`${g.emoji} ${g.count}, ${g.mine ? 'you reacted, click to remove' : 'click to react'}`}
            disabled={!canReact && !g.mine}
            onClick={() => toggle(g.emoji, g.mine)}
          >
            <span className="reaction-emoji">{g.emoji}</span>
            <span className="reaction-count">{g.count}</span>
          </button>
        );
      })}
      {canReact && (
        <button ref={add} type="button" className="reaction add" title="Add reaction" aria-label="Add reaction" onClick={() => setPicking((p) => !p)}>
          <Icon name="smilePlus" size={16} />
        </button>
      )}
      {picking && (
        <EmojiPicker
          anchor={add.current}
          title="Add reaction"
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            if (p.kind === 'unicode') toggle(p.char, groups.find((g) => g.emoji === p.char)?.mine ?? null);
          }}
        />
      )}
      {error && <span className="small danger-text">{error}</span>}
    </div>
  );
}

/** Row of one-click reactions shown above a message on hover / in its menu. */
export function QuickReactBar({ row, groups, onMore, compact }: { row: MessageRow; groups: ReactionGroup[]; onMore: (anchor: HTMLElement) => void; compact?: boolean }) {
  const recent = useSettings((s) => s.recentReactions);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    loadEmoji();
  }, []);
  const set = quickReactionSet(recent);
  return (
    <div className={`quick-react${compact ? ' compact' : ''}`} role="toolbar" aria-label="Quick reactions">
      {set.map((e) => {
        const mine = groups.find((g) => g.emoji === e)?.mine ?? null;
        return (
          <button key={e} type="button" className={mine ? 'on' : ''} title={`React with :${nameOfEmoji(e)}:`} onClick={() => toggleReaction(row, e, mine).catch((err) => alert(errorMessage(err)))}>
            {e}
          </button>
        );
      })}
      <button ref={more} type="button" title="More reactions" aria-label="More reactions" onClick={() => more.current && onMore(more.current)}>
        <Icon name="smilePlus" size={16} />
      </button>
    </div>
  );
}

export function PollView({ row, poll, state, ctx }: { row: MessageRow; poll: NonNullable<MessagePayload['poll']>; state?: PollState; ctx?: MentionContext }) {
  const me = sessionStore.use((s) => s.identity?.userId);
  const [pending, setPending] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voters, setVoters] = useState<number | null>(null);
  const total = state ? state.counts.reduce((a, b) => a + b, 0) : 0;
  const expired = Boolean(state?.expires_at && new Date(state.expires_at).getTime() < Date.now());
  const mine = pending ?? state?.mine ?? [];
  const voted = (state?.mine.length ?? 0) > 0;
  const showResults = voted || expired || row.author_id === me;

  async function submit(options: number[]) {
    setError(null);
    try {
      await votePoll(row.id, row.channel_id, options);
      setPending(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function click(i: number) {
    if (expired || !state) return;
    if (state.multi) setPending((p) => {
      const cur = p ?? state.mine;
      return cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
    });
    else submit(mine.includes(i) ? [] : [i]);
  }

  return (
    <div className="poll" role="group" aria-label={`Poll: ${poll.question}`}>
      <div className="poll-q">
        <Icon name="poll" size={16} />
        <Markdown text={poll.question} ctx={ctx} />
      </div>
      <div className="small muted poll-sub">
        {state?.multi ? 'Pick one or more' : 'Pick one'}
        {state?.anonymous ? ' · anonymous' : ''}
        {state?.expires_at ? ` · ${expired ? 'ended' : 'ends'} ${new Date(state.expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
      </div>
      {!state && <div className="small muted">Loading poll…</div>}
      {state &&
        poll.options.map((o, i) => {
          const n = state.counts[i] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const chosen = mine.includes(i);
          return (
            <button key={i} type="button" className={`poll-option${chosen ? ' chosen' : ''}`} disabled={expired} onClick={() => click(i)} aria-pressed={chosen}>
              {showResults && <span className="poll-bar" style={{ width: `${pct}%` }} />}
              <span className={`poll-check${state.multi ? ' square' : ''}`}>{chosen && <Icon name="check" size={12} />}</span>
              <span className="grow poll-label">{o}</span>
              {showResults && (
                <span
                  className="small poll-count"
                  onClick={(e) => {
                    if (state.anonymous) return;
                    e.stopPropagation();
                    setVoters(voters === i ? null : i);
                  }}
                  title={state.anonymous ? 'Anonymous poll' : 'See who voted'}
                >
                  {n} · {pct}%
                </span>
              )}
            </button>
          );
        })}
      {voters !== null && state?.voters && (
        <div className="small muted poll-voters">Voted “{poll.options[voters]}”: {(state.voters[voters] ?? []).map((u) => displayName(u)).join(', ') || 'nobody yet'}</div>
      )}
      <div className="poll-foot small muted">
        {total} vote{total === 1 ? '' : 's'}
        {state?.multi && pending && (
          <button className="btn small primary" onClick={() => submit(pending)}>
            Vote
          </button>
        )}
        {voted && !expired && (
          <button className="btn link small" onClick={() => submit([])}>
            Remove vote
          </button>
        )}
        {error && <span className="danger-text">{error}</span>}
      </div>
    </div>
  );
}

/** Previous versions of an edited message (still end-to-end encrypted on the server). */
export function EditHistoryModal({ row, current, onClose, ctx }: { row: MessageRow; current: string; onClose: () => void; ctx?: MentionContext }) {
  const [items, setItems] = useState<{ text: string | null; at: string }[] | null>(null);
  useEffect(() => {
    (async () => {
      const keyring = sessionStore.get().keyring!;
      const { data } = await supabase.from('message_revisions').select('*').eq('message_id', row.id).order('replaced_at', { ascending: true });
      const out: { text: string | null; at: string }[] = [];
      for (const r of (data ?? []) as (MessageRow & { written_at: string })[]) {
        const d = await keyring.decrypt({ ...r, id: row.id, channel_id: row.channel_id, author_id: row.author_id, reply_to: null, created_at: r.written_at, edited_at: null });
        out.push({ text: d.payload?.text ?? null, at: r.written_at });
      }
      setItems(out);
    })();
  }, [row.id, row.channel_id, row.author_id]);
  return (
    <Modal title="Edit history" onClose={onClose}>
      <p className="small muted">Earlier versions stay end-to-end encrypted: only people in this conversation can read them.</p>
      <div className="edit-history">
        {!items && <div className="spinner small" />}
        {items?.length === 0 && <p className="muted">No earlier versions were kept for this message.</p>}
        {items?.map((it, i) => (
          <div key={i} className="edit-version">
            <div className="small muted">{new Date(it.at).toLocaleString()}</div>
            {it.text === null ? <i className="muted">Can’t decrypt this version.</i> : <Markdown text={it.text} ctx={ctx} />}
          </div>
        ))}
        {items && (
          <div className="edit-version current">
            <div className="small muted">Now{row.edited_at ? ` · edited ${new Date(row.edited_at).toLocaleString()}` : ''}</div>
            <Markdown text={current} ctx={ctx} />
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ThreadSummary({ t, onOpen }: { t: ThreadInfo; onOpen: () => void }) {
  return (
    <button type="button" className="thread-summary" onClick={onOpen} title="Open thread">
      <Icon name="thread" size={15} />
      <b>{t.name}</b>
      <span className="muted small">
        {t.message_count} message{t.message_count === 1 ? '' : 's'}
        {t.locked ? ' · locked' : ''}
        {t.archived ? ' · archived' : ''} · {new Date(t.last_message_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}
