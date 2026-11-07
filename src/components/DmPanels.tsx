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
import { bannerStyle, openProfile, ServerTag, StatusCloud, userMenu } from './People';
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
  // the panel takes the person's own colours (accent → banner) like a profile card
  const c1 = p.accent_color ?? p.banner_color ?? p.avatar_color ?? '#2a2d36';
  const c2 = p.banner_color2 ?? p.banner_color ?? c1;
  const style = { '--pc1': c1, '--pc2': c2 } as CSSProperties;
  return (
    <aside className="dm-profile-panel" style={style} aria-label={`${displayName(id)}’s profile`}>
      <div className="dpp-card">
        <ProfileEffect id={p.profile_effect} className="dpp-fx" />
        <div className="dpp-banner" style={bannerStyle(p)}>
          {p.banner_url && <img src={p.banner_url} alt="" />}
          <div className="dpp-banner-actions">
            <button className="dpp-round" title="More" aria-label="More" onClick={(e) => openMenu(e, userMenu(id))}>
              <Icon name="more" size={16} />
            </button>
          </div>
        </div>
        <div className="dpp-head">
          <div className="dpp-avatar">
            <Avatar profile={p} size={84} online={onlineNow} frame />
          </div>
          {!!(p.status_text || p.status_emoji) && <StatusCloud text={p.status_text ?? ''} emoji={p.status_emoji ?? ''} />}
        </div>
        <div className="dpp-body">
          <h2 className="dpp-name">
            <StyledName style={p.name_style}>{displayName(id)}</StyledName>
          </h2>
          <div className="dpp-handle">
            <span>{p.username}</span>
            {p.pronouns && <span className="muted">· {p.pronouns}</span>}
            <ServerTag tag={p.server_tag} serverId={p.tag_server_id} />
            <Badges ids={p.badges} display={p.badge_display} size={16} />
          </div>
          {(mutualFriends.length > 0 || mutualServers.length > 0) && (
            <button className="dpp-mutuals" onClick={() => openProfile(id)}>
              <span className="dpp-mutual-avatars">
                {mutualFriends.slice(0, 3).map((f) => (
                  <Avatar key={f} profile={getProfile(f)} size={18} />
                ))}
              </span>
              {mutualFriends.length > 0 && `${mutualFriends.length} Mutual Friend${mutualFriends.length === 1 ? '' : 's'}`}
              {mutualFriends.length > 0 && mutualServers.length > 0 && <span className="dot">•</span>}
              {mutualServers.length > 0 && `${mutualServers.length} Mutual Server${mutualServers.length === 1 ? '' : 's'}`}
            </button>
          )}
          {p.about && (
            <div className="dpp-about">
              <Markdown text={p.about} />
            </div>
          )}
          <div className="dpp-section">
            <h4>Member Since</h4>
            <div>{fmtDate(p.created_at)}</div>
          </div>
          {inCall.others.includes(id) && (
            <div className="dpp-box">
              <h4>In a call</h4>
              <div className="dpp-call">
                <span className="dpp-call-avatars">
                  <Avatar profile={p} size={28} />
                  {inCall.here && <Avatar profile={sessionStore.get().me} size={28} />}
                </span>
                <span className="grow">
                  <Icon name="phone" size={13} /> This conversation
                </span>
              </div>
              {!inCall.here && (
                <button className="btn dpp-btn" onClick={onJoinCall}>
                  Join Call
                </button>
              )}
            </div>
          )}
          <ActivityCard userId={id} />
        </div>
        <button className="btn dpp-btn dpp-full" onClick={() => openProfile(id)}>
          View Full Profile
        </button>
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
