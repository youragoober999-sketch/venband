import { useEffect, useState } from 'react';
import { moderate, TIMEOUTS } from './ReportViews';
import { supabase, errorMessage } from '../lib/supabase';
import { isTopStaff, sessionStore } from '../lib/session';
import { fingerprint } from '../lib/crypto';
import { acceptKeyChange, displayName, getCurrentKey, getProfile, loadProfiles, markVerified, trustState } from '../lib/directory';
import { joinCall } from '../lib/call';
import { has, P } from '../lib/permissions';
import { forceAcceptFriendRequest, removeFriend, respondFriend, sendFriendRequest, setRelation, socialStore } from '../lib/social';
import { openSettings, uiStore } from '../lib/ui';
import type { Profile } from '../lib/types';
import { openChannel, openServer, useDirectory, type ServerData } from '../hooks/data';
import { Avatar, Icon, Modal, nameplateVars, StyledName } from './ui';
import { Badges, OwnerCrown, RoleIcon } from './Badges';
import { ActivityCard } from './ActivityCard';
import { copyText, type Entry } from './ContextMenu';
import { askConfirm, askText } from './Dialogs';
import { openGlobalModal } from './GlobalModals';
import { reportUser } from '../lib/reports';
import { Markdown } from './Markdown';
import { startDm } from './Modals';

export const NAMEPLATES: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'ember', label: 'Ember' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'circuit', label: 'Circuit' },
  { id: 'noir', label: 'Noir' },
  { id: 'gold', label: 'Gold' },
];

/** A server's tag next to someone's name. Click it to see the server (and join, if it's open). */
export function ServerTag({ tag, serverId }: { tag?: string | null; serverId?: string | null }) {
  if (!tag) return null;
  if (!serverId) return <span className="server-tag">{tag}</span>;
  return (
    <button
      type="button"
      className="server-tag clickable"
      title="See this server"
      onClick={(e) => {
        e.stopPropagation();
        openGlobalModal({ kind: 'server-preview', serverId });
      }}
    >
      {tag}
    </button>
  );
}

export function bannerStyle(p?: Partial<Profile> | null) {
  if (p?.banner_url) return { backgroundImage: `url("${p.banner_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  const a = p?.banner_color ?? p?.avatar_color ?? '#7c5cff';
  const b = p?.banner_color2;
  return { background: b ? `linear-gradient(135deg, ${a}, ${b})` : `linear-gradient(145deg, ${a} 25%, color-mix(in srgb, ${a} 45%, #000))` };
}

export function accountAge(created?: string): string {
  if (!created) return '';
  const d = new Date(created);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (days < 1) return `${when} · today`;
  if (days < 31) return `${when} · ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${when} · ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  return `${when} · ${years} year${years === 1 ? '' : 's'} ago`;
}

async function callUser(userId: string) {
  const identity = sessionStore.get().identity;
  if (!identity) return;
  const { data, error } = await supabase.rpc('open_dm', { p_other: userId });
  if (error) throw error;
  openChannel('@me', data as string);
  await joinCall(identity, data as string, data as string, displayName(userId), { ring: true });
}

function report(e: unknown) {
  alert(errorMessage(e));
}

/** Everything you can do to a person, for right-click menus and "…" buttons. */
export function userMenu(userId: string, opts: { data?: ServerData; onProfile?: () => void } = {}): Entry[] {
  const me = sessionStore.get().me;
  if (!me) return [];
  const self = userId === me.id;
  const { friends, relations } = socialStore.get();
  const f = friends[userId];
  const rel = relations[userId];
  const profile = getProfile(userId);
  const data = opts.data;
  const member = data?.members.find((m) => m.user_id === userId);
  const p = data?.myPermissions ?? 0;
  const myTop = data?.server?.owner_id === me.id ? Infinity : (data?.topRole(me.id)?.position ?? 0);
  const outranks = data && userId !== data.server?.owner_id && (data.topRole(userId)?.position ?? 0) < myTop;
  const staff = (me.platform_role ?? 'user') !== 'user';
  const force = me.platform_role === 'admin' || me.platform_role === 'owner' || isTopStaff(me);
  const name = displayName(userId, member?.nickname);

  return [
    { type: 'header', label: name },
    { label: 'Profile', icon: 'user', onClick: () => (opts.onProfile ? opts.onProfile() : openProfile(userId, data?.server?.id)) },
    !self && { label: 'Message', icon: 'message', onClick: () => startDm(userId).catch(report) },
    !self && { label: 'Call', icon: 'phone', onClick: () => callUser(userId).catch(report) },
    !self && { label: 'Invite to Server', icon: 'userPlus', onClick: () => openGlobalModal({ kind: 'invite-to-servers', userId }) },
    { type: 'sep' },
    !self && !f && !rel?.blocked && profile && {
      label: 'Add Friend',
      icon: 'userPlus',
      onClick: () => sendFriendRequest(profile.username).catch(report),
    },
    !self && f && !f.accepted && f.incoming && { label: 'Accept Friend Request', icon: 'userPlus', onClick: () => respondFriend(userId, true).catch(report) },
    !self && f && !f.accepted && !f.incoming && { label: 'Cancel Friend Request', icon: 'userMinus', onClick: () => removeFriend(userId).catch(report) },
    !self && f?.accepted && {
      label: 'Remove Friend',
      icon: 'userMinus',
      danger: true,
      onClick: async () => {
        if (await askConfirm({ title: 'Remove friend', body: `Remove ${name} from your friends?`, confirm: 'Remove Friend', danger: true }))
          removeFriend(userId).catch(report);
      },
    },
    !self && {
      label: rel?.nickname ? 'Change Nickname' : 'Add Nickname',
      icon: 'edit',
      onClick: async () => {
        const v = await askText({
          title: 'Nickname',
          label: `Only you see this name for ${profile?.display_name ?? 'them'}`,
          initial: rel?.nickname ?? '',
          maxLength: 32,
        });
        if (v !== null) setRelation(userId, { nickname: v.trim() || null }).catch(report);
      },
    },
    !self && f?.accepted && { type: 'check', label: 'Pin Friend', checked: Boolean(rel?.pinned), onChange: (v) => setRelation(userId, { pinned: v }).catch(report) },
    !self && { type: 'check', label: 'Mute', checked: Boolean(rel?.muted), onChange: (v) => setRelation(userId, { muted: v }).catch(report) },
    !self && {
      label: rel?.blocked ? 'Unblock' : 'Block',
      icon: 'block',
      danger: !rel?.blocked,
      onClick: async () => {
        if (rel?.blocked) return setRelation(userId, { blocked: false }).catch(report);
        if (
          await askConfirm({
            title: `Block ${name}?`,
            body: 'They won’t be able to message you or send friend requests, and their messages are hidden. They are not told.',
            confirm: 'Block',
            danger: true,
          })
        )
          setRelation(userId, { blocked: true }).catch(report);
      },
    },
    !self && force && {
      label: 'Force message',
      icon: 'message',
      hint: 'Even if they blocked you',
      onClick: () => startDm(userId).catch(report),
    },
    !self && force && {
      label: 'Unblock you from them',
      icon: 'block',
      hint: 'Admins, owners and founders overrule blocks',
      onClick: async () => {
        const { error } = await supabase.rpc('force_unblock', { p_user: userId });
        if (error) report(error);
      },
    },
    !self && force && f && !f.accepted && {
      label: 'Force accept friend request',
      icon: 'userPlus',
      hint: 'Admins, owners and founders overrule pending requests',
      onClick: () => forceAcceptFriendRequest(userId).catch(report),
    },
    data && { type: 'sep' },
    data && self && {
      label: 'Change Server Nickname',
      icon: 'edit',
      onClick: async () => {
        const v = await askText({ title: 'Server nickname', label: `Your name in ${data.server?.name}`, initial: member?.nickname ?? '', maxLength: 32 });
        if (v === null) return;
        const { error } = await supabase.from('server_members').update({ nickname: v.trim() || null }).eq('server_id', data.server!.id).eq('user_id', me.id);
        if (error) report(error);
        else data.reload();
      },
    },
    data && !self && outranks && has(p, P.MODERATE_MEMBERS) && {
      type: 'custom',
      render: (close) => (
        <div className="ctx-timeouts">
          <span className="ctx-timeouts-label">
            <Icon name="clock" size={14} /> {member?.timeout_until && new Date(member.timeout_until) > new Date() ? 'Timed out · change' : `Time out ${name}`}
          </span>
          <div className="ctx-timeouts-row">
            {TIMEOUTS.map(([label, mins]) => (
              <button
                key={mins}
                className="chip small"
                onClick={async () => {
                  close();
                  const t = await moderate('timeout', data.server!.id, userId, mins);
                  if (t && !/timed out/.test(t)) report(new Error(t));
                }}
              >
                {label.replace(' seconds', 's').replace(' minutes', 'm').replace(' hour', 'h').replace(' days', 'd').replace(' day', 'd').replace(' week', 'w')}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    data && !self && outranks && has(p, P.MODERATE_MEMBERS) && member?.timeout_until && new Date(member.timeout_until) > new Date() && {
      label: 'Remove Timeout',
      icon: 'clock',
      onClick: () => supabase.rpc('timeout_member', { p_server: data.server!.id, p_user: userId, p_minutes: 0, p_reason: '' }).then(({ error }) => error && report(error)),
    },
    data && !self && outranks && (has(p, P.MODERATE_MEMBERS) || has(p, P.KICK_MEMBERS)) && {
      label: `Warn ${name}`,
      icon: 'warning',
      onClick: async () => {
        const t = await moderate('warn', data.server!.id, userId);
        if (t && !/was warned/.test(t)) report(new Error(t));
      },
    },
    data && !self && outranks && has(p, P.KICK_MEMBERS) && {
      label: `Kick ${name}`,
      danger: true,
      icon: 'userMinus',
      onClick: async () => {
        if (!(await askConfirm({ title: `Kick ${name}?`, body: 'They can rejoin with a new invite. Channel keys are rotated so they can’t read anything new.', confirm: 'Kick', danger: true }))) return;
        const { error } = await supabase.from('server_members').delete().eq('server_id', data.server!.id).eq('user_id', userId);
        if (error) report(error);
      },
    },
    data && !self && outranks && has(p, P.BAN_MEMBERS) && {
      label: `Ban ${name}`,
      danger: true,
      icon: 'gavel',
      onClick: async () => {
        const reason = await askText({ title: `Ban ${name}`, label: 'Reason (optional, only moderators see it)', maxLength: 512 });
        if (reason === null) return;
        const { error } = await supabase.from('bans').insert({ server_id: data.server!.id, user_id: userId, banned_by: me.id, reason });
        if (error) report(error);
      },
    },
    !self && {
      label: 'Report User',
      icon: 'flag',
      danger: true,
      onClick: async () => {
        const reason = await askText({ title: `Report ${name}`, label: 'What happened?', placeholder: 'Harassment, scams, threats…', maxLength: 1000 });
        if (!reason?.trim()) return;
        const includeDms = await askConfirm({
          title: 'Include your DMs as evidence?',
          body: `Messages are end-to-end encrypted, so Venband staff can only see what you share. Include your most recent messages with ${name}? Only staff reviewing the report can read them.`,
          confirm: 'Include DMs',
        });
        try {
          const n = await reportUser(userId, reason.trim(), includeDms);
          alert(`Thanks. Your report is under review${n ? ` (with ${n} messages as evidence)` : ''}.`);
        } catch (e) {
          report(e);
        }
      },
    },
    { type: 'sep' },
    staff && !self && { label: 'Open in Moderation', icon: 'shield', onClick: () => openSettings('moderation', profile?.username ?? userId) },
    profile && { label: 'Copy Username', icon: 'copy', onClick: () => copyText(profile.username) },
    { label: 'Copy User ID', icon: 'copy', hint: 'ID', onClick: () => copyText(userId) },
  ];
}

// ------------------------------------------------------------ profile view --


export function openProfile(userId: string, serverId?: string) {
  uiStore.set({ profile: { userId, serverId } });
}

export function ProfileModal({ userId, data, onClose }: { userId: string; data?: ServerData; onClose: () => void }) {
  useDirectory();
  const profile = getProfile(userId);
  const me = sessionStore.use((s) => s.me)!;
  const friends = socialStore.use((s) => s.friends);
  const relations = socialStore.use((s) => s.relations);
  const self = userId === me.id;
  const shown = self ? me : profile;
  const member = data?.members.find((m) => m.user_id === userId);
  const roles = data?.rolesOf(userId) ?? [];
  const [tab, setTab] = useState<'about' | 'servers' | 'friends'>('about');
  const [mutualServers, setMutualServers] = useState<{ id: string; name: string; icon_color: string }[]>([]);
  const [mutualFriends, setMutualFriends] = useState<string[]>([]);
  const [fp, setFp] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [note, setNote] = useState(relations[userId]?.note ?? '');
  const trust = trustState(userId);
  const f = friends[userId];
  const rel = relations[userId];

  useEffect(() => {
    loadProfiles([userId], true);
    if (self) return;
    supabase.rpc('mutual_servers', { p_other: userId }).then(({ data }) => setMutualServers((data ?? []) as typeof mutualServers));
    supabase.rpc('mutual_friends', { p_other: userId }).then(async ({ data }) => {
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      await loadProfiles(ids);
      setMutualFriends(ids);
    });
  }, [userId, self]);

  useEffect(() => {
    getCurrentKey(userId, true).then(async (k) => {
      if (!k) return;
      setKeyId(k.key_id);
      setFp(await fingerprint(k.enc_public, k.sign_public));
    });
  }, [userId]);

  const name = displayName(userId, member?.nickname);
  return (
    <Modal title="" onClose={onClose}>
      <div className={`profile-card nameplate-${shown?.nameplate ?? 'none'}`} style={nameplateVars(shown)}>
        <div className="profile-banner" style={bannerStyle(shown)} />
        <div className="profile-head">
          <div className="profile-avatar">
            <Avatar profile={shown} size={88} />
          </div>
          <div className="profile-actions">
            {self ? (
              <button className="btn secondary small" onClick={() => (onClose(), openSettings('profile'))}>
                <Icon name="edit" size={14} /> Edit Profile
              </button>
            ) : (
              <>
                <button className="btn primary small" onClick={() => startDm(userId).then(onClose).catch(report)}>
                  <Icon name="message" size={14} /> Message
                </button>
                {!f && !rel?.blocked && shown && (
                  <button className="btn secondary small" onClick={() => sendFriendRequest(shown.username).catch(report)}>
                    <Icon name="userPlus" size={14} /> Add Friend
                  </button>
                )}
                {f && !f.accepted && f.incoming && (
                  <button className="btn success small" onClick={() => respondFriend(userId, true).catch(report)}>
                    Accept Request
                  </button>
                )}
                {f && !f.accepted && !f.incoming && <span className="tag-soft">Request sent</span>}
              </>
            )}
          </div>
        </div>
        <div className="profile-body">
          <div className="profile-names">
            <h2>
              <StyledName style={shown?.name_style}>{name}</StyledName>
              {!self && data?.server?.owner_id === userId && <OwnerCrown size={16} label="Server owner" />}
              <Badges ids={shown?.badges} size={18} />
            </h2>
            <div className="muted">
              @{shown?.username}
              {shown?.pronouns ? ` · ${shown.pronouns}` : ''}
              <ServerTag tag={shown?.server_tag} serverId={shown?.tag_server_id} />
            </div>
            {!!shown?.status_text && (
              <div className="status-bubble" role="note" aria-label="Status">
                {shown.status_text}
              </div>
            )}
            <ActivityCard userId={userId} />
            {rel?.blocked && <div className="notice small">You blocked this person.</div>}
            {shown?.account_status && shown.account_status !== 'active' && (shown.platform_role === 'user' || !shown.platform_role) && me.platform_role !== 'user' && (
              <div className="notice small">Account status: {shown.account_status.replace('_', ' ')}</div>
            )}
          </div>
          {!self && (
            <div className="tabs small">
              <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
                About
              </button>
              <button className={tab === 'servers' ? 'active' : ''} onClick={() => setTab('servers')}>
                Mutual Servers{mutualServers.length ? ` · ${mutualServers.length}` : ''}
              </button>
              <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
                Mutual Friends{mutualFriends.length ? ` · ${mutualFriends.length}` : ''}
              </button>
            </div>
          )}
          {tab === 'about' && (
            <div className="profile-about">
              {shown?.about && (
                <section>
                  <h4>About me</h4>
                  <div className="profile-bio">
                    <Markdown text={shown.about} />
                  </div>
                </section>
              )}
              <section className="profile-dates">
                <div>
                  <h4>Venband member since</h4>
                  <span>{accountAge(shown?.created_at)}</span>
                </div>
                {member && (
                  <div>
                    <h4>Joined {data?.server?.name}</h4>
                    <span>{accountAge(member.joined_at)}</span>
                  </div>
                )}
              </section>
              {roles.length > 0 && (
                <section>
                  <h4>Roles</h4>
                  <div className="role-pills">
                    {roles.map((r) => (
                      <span key={r.id} className="role-pill">
                        <span className="role-dot" style={{ background: r.color }} />
                        {r.icon && <RoleIcon icon={r.icon} size={13} />}
                        {r.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}
              {!self && (
                <section>
                  <h4>Note (only you can see it)</h4>
                  <textarea
                    className="profile-note"
                    maxLength={256}
                    placeholder="Click to add a note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => note !== (rel?.note ?? '') && setRelation(userId, { note }).catch(report)}
                  />
                </section>
              )}
              <details className="security-box">
                <summary className="security-title">
                  <Icon name="shield" size={16} /> Security fingerprint
                  {trust === 'verified' && <span className="trust-ok"> · Verified</span>}
                  {trust === 'changed' && <span className="trust-warn"> · Key changed!</span>}
                </summary>
                <code className="fingerprint">{fp ?? 'Loading…'}</code>
                {!self && (
                  <>
                    <p className="small muted">
                      Compare this with {shown?.display_name ?? 'them'} in person or over another trusted channel. If it matches their “My
                      fingerprint” in settings, nobody is intercepting your conversation.
                    </p>
                    {keyId && trust !== 'verified' && (
                      <button className="btn secondary small" onClick={() => (trust === 'changed' ? acceptKeyChange(userId, keyId) : markVerified(userId, keyId))}>
                        {trust === 'changed' ? 'Accept new key' : 'Mark as verified'}
                      </button>
                    )}
                  </>
                )}
              </details>
            </div>
          )}
          {tab === 'servers' && (
            <div className="mutual-list">
              {mutualServers.map((s) => (
                <button key={s.id} className="mutual-row" onClick={() => (openServer(s.id), onClose())}>
                  <span className="server-icon-sm" style={{ background: s.icon_color }}>
                    {s.name.slice(0, 2).toUpperCase()}
                  </span>
                  {s.name}
                </button>
              ))}
              {!mutualServers.length && <p className="muted small">No servers in common.</p>}
            </div>
          )}
          {tab === 'friends' && (
            <div className="mutual-list">
              {mutualFriends.map((id) => (
                <button key={id} className="mutual-row" onClick={() => openProfile(id)}>
                  <Avatar profile={getProfile(id)} size={28} />
                  {displayName(id)}
                </button>
              ))}
              {!mutualFriends.length && <p className="muted small">No friends in common.</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Renders the profile opened with openProfile(). Mount once per view. */
export function ProfileHost({ data }: { data?: ServerData }) {
  const open = uiStore.use((s) => s.profile);
  if (!open) return null;
  const close = () => uiStore.set({ profile: null });
  return <ProfileModal key={open.userId} userId={open.userId} data={data && (!open.serverId || open.serverId === data.server?.id) ? data : undefined} onClose={close} />;
}
