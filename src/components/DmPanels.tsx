// Right-hand panels for conversations:
//  * DmProfilePanel — a 1:1 DM shows the other person's profile: banner, avatar
//    with decoration + status, their status bubble, name / tag / badges,
//    mutual friends & servers, about me, member since, "In a call" and what
//    they're playing, with their profile effect over it and their colours.
//  * GroupMembersPanel — a group DM lists everyone: online first, offline
//    dimmed, a crown on the owner, status + activity lines, and an invite button.
import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { useDirectory } from '../hooks/data';
import { useOnline } from '../lib/online';
import type { DmChannel, Profile } from '../lib/types';
import { ActivityCard, ActivityMini } from './ActivityCard';
import { Badges, OwnerCrown } from './Badges';
import { NameplateArt, ProfileEffect } from './Cosmetics';
import { Markdown } from './Markdown';
import { bannerStyle, openProfile, ServerTag, userMenu } from './People';
import { openMenu } from './ContextMenu';
import { Avatar, Icon, StyledName } from './ui';
import './dmpanels.css';

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** The profile card in the right-hand column of a 1:1 DM. */
export function DmProfilePanel({ dm, inCall, onJoinCall }: { dm: DmChannel; inCall: { here: boolean; others: string[] }; onJoinCall: () => void }) {
  useDirectory();
  const id = dm.other!.id;
  const p: Profile = getProfile(id) ?? dm.other!;
  const onlineNow = useOnline([id]).has(id);
  const [mutualFriends, setMutualFriends] = useState<string[]>([]);
  const [mutualServers, setMutualServers] = useState<{ id: string; name: string; icon_color: string }[]>([]);
  useEffect(() => {
    let live = true;
    supabase.rpc('mutual_friends', { p_other: id }).then(async ({ data }) => {
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      await loadProfiles(ids);
      if (live) setMutualFriends(ids);
    });
    supabase.rpc('mutual_servers', { p_other: id }).then(({ data }) => live && setMutualServers((data ?? []) as typeof mutualServers));
    return () => {
      live = false;
    };
  }, [id]);
  const [tab, setTab] = useState<'about' | 'mutuals'>('about');
  // Venband's own look: their colours become a soft glow behind a centred avatar
  const c1 = p.accent_color ?? p.banner_color ?? p.avatar_color ?? '#2a2d36';
  const c2 = p.banner_color2 ?? p.banner_color ?? c1;
  const style = { '--pc1': c1, '--pc2': c2 } as CSSProperties;
  const days = p.created_at ? Math.max(1, Math.round((Date.now() - new Date(p.created_at).getTime()) / 86_400_000)) : null;
  return (
    <aside className="dm-profile-panel vb-pp" style={style} aria-label={`${displayName(id)}’s profile`}>
      <ProfileEffect id={p.profile_effect} className="vpp-fx" />
      <div className="vpp-glow" style={bannerStyle(p)}>
        {p.banner_url && <img src={p.banner_url} alt="" />}
      </div>
      <div className="vpp-top">
        <button className="vpp-icon" title="More" aria-label="More" onClick={(e) => openMenu(e, userMenu(id))}>
          <Icon name="more" size={16} />
        </button>
      </div>
      <div className="vpp-hero">
        <div className="vpp-avatar">
          <Avatar profile={p} size={96} online={onlineNow} frame />
        </div>
        <h2 className="vpp-name">
          <StyledName style={p.name_style}>{displayName(id)}</StyledName>
        </h2>
        <div className="vpp-handle">
          @{p.username}
          {p.pronouns && <span>· {p.pronouns}</span>}
        </div>
        <div className="vpp-tags">
          <ServerTag tag={p.server_tag} serverId={p.tag_server_id} />
          <Badges ids={p.badges} display={p.badge_display} size={16} />
        </div>
        {!!(p.status_text || p.status_emoji) && (
          <div className="vpp-status">
            {p.status_emoji && <span>{p.status_emoji}</span>}
            {p.status_text}
          </div>
        )}
      </div>
      <div className="vpp-actions">
        <button className="vpp-action" onClick={onJoinCall} title={inCall.others.includes(id) ? 'Join their call' : 'Start a call'}>
          <Icon name="phone" size={17} />
          <span>{inCall.others.includes(id) && !inCall.here ? 'Join' : 'Call'}</span>
        </button>
        <button className="vpp-action" onClick={() => openProfile(id)}>
          <Icon name="user" size={17} />
          <span>Profile</span>
        </button>
        <button className="vpp-action" onClick={(e) => openMenu(e, userMenu(id))}>
          <Icon name="more" size={17} />
          <span>More</span>
        </button>
      </div>
      <div className="vpp-stats">
        <button className="vpp-stat" onClick={() => setTab('mutuals')}>
          <b>{mutualFriends.length}</b>
          <span>mutual friend{mutualFriends.length === 1 ? '' : 's'}</span>
        </button>
        <button className="vpp-stat" onClick={() => setTab('mutuals')}>
          <b>{mutualServers.length}</b>
          <span>mutual server{mutualServers.length === 1 ? '' : 's'}</span>
        </button>
        <div className="vpp-stat">
          <b>{days ?? '—'}</b>
          <span>day{days === 1 ? '' : 's'} on Venband</span>
        </div>
      </div>
      {inCall.others.includes(id) && (
        <div className="vpp-live">
          <span className="vpp-live-dot" />
          <span className="grow">In a call with you{inCall.here ? '' : ' — waiting'}</span>
          {!inCall.here && (
            <button className="btn small success" onClick={onJoinCall}>
              Join
            </button>
          )}
        </div>
      )}
      <div className="vpp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'about'} className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
          About
        </button>
        <button role="tab" aria-selected={tab === 'mutuals'} className={tab === 'mutuals' ? 'on' : ''} onClick={() => setTab('mutuals')}>
          Mutuals
        </button>
      </div>
      <div className="vpp-body">
        {tab === 'about' ? (
          <>
            {p.about ? (
              <div className="vpp-about">
                <Markdown text={p.about} />
              </div>
            ) : (
              <p className="vpp-empty">No bio yet.</p>
            )}
            <ActivityCard userId={id} />
            <div className="vpp-joined">
              <Icon name="calendar" size={14} /> Joined {fmtDate(p.created_at)}
            </div>
          </>
        ) : (
          <div className="vpp-mutuals">
            {!mutualFriends.length && !mutualServers.length && <p className="vpp-empty">Nothing in common yet.</p>}
            {mutualServers.map((s) => (
              <div key={s.id} className="vpp-mutual">
                <span className="vpp-server" style={{ background: s.icon_color }}>
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="grow">{s.name}</span>
              </div>
            ))}
            {mutualFriends.map((f) => (
              <button key={f} className="vpp-mutual" onClick={() => openProfile(f)}>
                <Avatar profile={getProfile(f)} size={28} frame={false} />
                <span className="grow">{displayName(f)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** The member list in the right-hand column of a group DM. */
export function GroupMembersPanel({ dm, inCall, onInvite }: { dm: DmChannel; inCall: string[]; onInvite: () => void }) {
  useDirectory();
  const me = sessionStore.use((s) => s.me)!;
  const ids = [me.id, ...dm.members.map((m) => m.id).filter((x) => x !== me.id)];
  const onlineSet = useOnline(ids);
  const isOn = (uid: string) => uid === me.id || onlineSet.has(uid) || inCall.includes(uid);
  const sorted = [...ids].sort((a, b) => Number(isOn(b)) - Number(isOn(a)) || displayName(a).localeCompare(displayName(b)));
  return (
    <aside className="group-members-panel" aria-label="Members">
      <h4 className="gm-title">Members — {ids.length}</h4>
      <div className="gm-list">
        {sorted.map((uid) => {
          const p = uid === me.id ? me : getProfile(uid) ?? dm.members.find((m) => m.id === uid) ?? null;
          const on = isOn(uid);
          const status = p?.status_text || p?.status_emoji ? `${p?.status_emoji ?? ''} ${p?.status_text ?? ''}`.trim() : null;
          return (
            <button
              key={uid}
              className={`gm-row member nameplate-row${on ? '' : ' offline'}`}
              onClick={() => openProfile(uid)}
              onContextMenu={(e) => openMenu(e, userMenu(uid))}
            >
              <NameplateArt id={on ? p?.nameplate : null} />
              <Avatar profile={p} size={32} online={on} frame />
              <span className="gm-text">
                <span className="gm-name">
                  <StyledName style={p?.name_style}>{displayName(uid)}</StyledName>
                  {dm.channel.owner_id === uid && <OwnerCrown size={13} label="Group owner" />}
                  <ServerTag tag={p?.server_tag} serverId={p?.tag_server_id} />
                </span>
                {on && (
                  <span className="gm-sub">
                    {inCall.includes(uid) ? (
                      <span className="gm-incall">
                        <Icon name="phone" size={11} /> In the call
                      </span>
                    ) : (
                      <ActivityMini userId={uid} />
                    )}
                    {status && <span className="gm-status">{status}</span>}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <button className="btn gm-invite" onClick={onInvite}>
        <Icon name="userPlus" size={16} /> Invite to Group
      </button>
    </aside>
  );
}
