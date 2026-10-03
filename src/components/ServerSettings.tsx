import { useCallback, useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { has, P, PERMISSION_INFO } from '../lib/permissions';
import type { Ban, Invite, Role } from '../lib/types';
import { openServer, type ServerData } from '../hooks/data';
import { Avatar, ColorPicker, Field, Modal } from './ui';

type Tab = 'overview' | 'roles' | 'members' | 'invites' | 'bans';

export function ServerSettingsModal({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const p = data.myPermissions;
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Overview', has(p, P.MANAGE_SERVER)],
    ['roles', 'Roles', has(p, P.MANAGE_ROLES)],
    ['members', 'Members', true],
    ['invites', 'Invites', has(p, P.MANAGE_SERVER)],
    ['bans', 'Bans', has(p, P.BAN_MEMBERS)],
  ];
  const visible = tabs.filter((t) => t[2]);
  const [tab, setTab] = useState<Tab>(visible[0][0]);
  return (
    <Modal title={`${data.server!.name} — Settings`} onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">
          {visible.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'overview' && <Overview data={data} onClose={onClose} />}
          {tab === 'roles' && <Roles data={data} />}
          {tab === 'members' && <Members data={data} />}
          {tab === 'invites' && <Invites data={data} />}
          {tab === 'bans' && <Bans data={data} />}
        </div>
      </div>
    </Modal>
  );
}

function Overview({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const server = data.server!;
  const me = sessionStore.use((s) => s.me)!;
  const [name, setName] = useState(server.name);
  const [color, setColor] = useState(server.icon_color);
  const [description, setDescription] = useState(server.description ?? '');
  const [tag, setTag] = useState(server.tag ?? '');
  const [banner, setBanner] = useState(server.banner_color ?? server.icon_color);
  const [discoverable, setDiscoverable] = useState(server.discoverable ?? true);
  const [welcome, setWelcome] = useState(server.welcome_channel_id ?? '');
  const [slurs, setSlurs] = useState(Boolean(server.automod?.slurs));
  const [msg, setMsg] = useState<string | null>(null);
  const [newOwner, setNewOwner] = useState('');
  const isOwner = server.owner_id === me.id;

  return (
    <div>
      {msg && <div className="notice">{msg}</div>}
      <Field label="Server name">
        <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Icon color">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Field label="Description" hint="Shown in Server Discovery.">
        <textarea maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="row">
        <Field label="Server tag" hint="2–4 letters or numbers members can wear next to their name.">
          <input maxLength={4} value={tag} placeholder="VNB" onChange={(e) => setTag(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
        </Field>
        <Field label="Welcome channel" hint="Join messages are posted here.">
          <select value={welcome} onChange={(e) => setWelcome(e.target.value)}>
            <option value="">No join messages</option>
            {data.channels
              .filter((c) => c.type === 'text')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="Banner color">
        <ColorPicker value={banner} onChange={setBanner} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
        Show in Server Discovery once it has 1,000+ members (verified servers always appear)
      </label>
      <h3>AutoMod</h3>
      <label className="checkbox">
        <input type="checkbox" checked={slurs} onChange={(e) => setSlurs(e.target.checked)} />
        Block slurs. Messages are end-to-end encrypted, so every member’s app enforces this: senders are stopped and matching messages are hidden.
      </label>
      <button
        className="btn primary"
        onClick={async () => {
          if (tag && tag.length < 2) return setMsg('Tags need 2–4 letters or numbers.');
          const { error } = await supabase
            .from('servers')
            .update({
              name: name.trim(),
              icon_color: color,
              description: description.trim(),
              tag: tag || null,
              banner_color: banner,
              discoverable,
              welcome_channel_id: welcome || null,
              automod: { ...(server.automod ?? {}), slurs },
            })
            .eq('id', server.id);
          setMsg(error ? errorMessage(error) : 'Saved.');
          data.reload();
        }}
      >
        Save Changes
      </button>
      {isOwner && (
        <>
          <hr />
          <h3>Transfer ownership</h3>
          <div className="copy-row">
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
              <option value="">Choose a member…</option>
              {data.members
                .filter((m) => m.user_id !== me.id)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {displayName(m.user_id, m.nickname)}
                  </option>
                ))}
            </select>
            <button
              className="btn danger"
              disabled={!newOwner}
              onClick={async () => {
                if (!confirm('Transfer ownership? You will lose owner rights.')) return;
                const { error } = await supabase.from('servers').update({ owner_id: newOwner }).eq('id', server.id);
                setMsg(error ? errorMessage(error) : 'Ownership transferred.');
                data.reload();
              }}
            >
              Transfer
            </button>
          </div>
          <hr />
          <h3>Danger zone</h3>
          <button
            className="btn danger"
            onClick={async () => {
              const typed = prompt(`Type the server name (${server.name}) to delete it forever:`);
              if (typed !== server.name) return;
              const { error } = await supabase.from('servers').delete().eq('id', server.id);
              if (error) return setMsg(errorMessage(error));
              onClose();
              openServer(null);
            }}
          >
            Delete Server
          </button>
        </>
      )}
    </div>
  );
}

function Roles({ data }: { data: ServerData }) {
  const me = sessionStore.use((s) => s.me)!;
  const [selected, setSelected] = useState<string | null>(data.roles[0]?.id ?? null);
  const role = data.roles.find((r) => r.id === selected) ?? null;
  const myTop = data.server!.owner_id === me.id ? Infinity : (data.topRole(me.id)?.position ?? 0);

  async function create() {
    const maxBelow = Math.max(0, ...data.roles.filter((r) => r.position < myTop).map((r) => r.position));
    const position = Math.min(maxBelow + 1, myTop === Infinity ? maxBelow + 1 : myTop - 1);
    if (position < 1) return alert('You cannot create roles above your own highest role.');
    const { data: r, error } = await supabase
      .from('roles')
      .insert({ server_id: data.server!.id, name: 'new role', color: '#99aab5', permissions: 0, position })
      .select()
      .single();
    if (error) return alert(errorMessage(error));
    data.reload();
    setSelected(r.id);
  }

  return (
    <div className="roles-layout">
      <div className="roles-list">
        <button className="btn secondary small full" onClick={create}>
          + Create Role
        </button>
        {data.roles.map((r) => (
          <button key={r.id} className={`role-item${selected === r.id ? ' active' : ''}`} onClick={() => setSelected(r.id)}>
            <span className="role-dot" style={{ background: r.color }} />
            {r.name}
          </button>
        ))}
      </div>
      {role && <RoleEditor key={role.id} role={role} data={data} editable={role.is_default || role.position < myTop} />}
    </div>
  );
}

function RoleEditor({ role, data, editable }: { role: Role; data: ServerData; editable: boolean }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [perms, setPerms] = useState(role.permissions);
  const [hoist, setHoist] = useState(role.hoist);
  const [position, setPosition] = useState(role.position);
  const [msg, setMsg] = useState<string | null>(null);
  const mine = data.myPermissions;

  return (
    <div className="role-editor">
      {msg && <div className="notice">{msg}</div>}
      {!editable && <div className="warning-box">This role is above your highest role, so you can’t edit it.</div>}
      <fieldset disabled={!editable}>
        <Field label="Role name">
          <input maxLength={100} value={name} disabled={role.is_default} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!role.is_default && (
          <>
            <Field label="Color">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
            <div className="row">
              <Field label="Position (higher = more powerful)">
                <input type="number" min={1} value={position} onChange={(e) => setPosition(Number(e.target.value))} />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={hoist} onChange={(e) => setHoist(e.target.checked)} />
              Display role members separately in the member list
            </label>
          </>
        )}
        <h3>Permissions</h3>
        <div className="perm-list">
          {PERMISSION_INFO.map((pi) => (
            <label key={pi.bit} className={`perm${!has(mine, pi.bit) ? ' locked' : ''}`}>
              <div>
                <b>{pi.name}</b>
                <div className="small muted">{pi.description}</div>
              </div>
              <input
                type="checkbox"
                className="toggle"
                disabled={!has(mine, pi.bit)}
                checked={has(perms, pi.bit)}
                onChange={(e) => setPerms(e.target.checked ? perms | pi.bit : perms & ~pi.bit)}
              />
            </label>
          ))}
        </div>
        <div className="modal-actions">
          {!role.is_default && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Delete role ${role.name}?`)) return;
                const { error } = await supabase.from('roles').delete().eq('id', role.id);
                if (error) setMsg(errorMessage(error));
                data.reload();
              }}
            >
              Delete Role
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const patch = role.is_default ? { permissions: perms } : { name: name.trim(), color, permissions: perms, hoist, position };
              const { error } = await supabase.from('roles').update(patch).eq('id', role.id);
              setMsg(error ? errorMessage(error) : 'Saved.');
              data.reload();
            }}
          >
            Save Changes
          </button>
        </div>
      </fieldset>
    </div>
  );
}

function Members({ data }: { data: ServerData }) {
  const me = sessionStore.use((s) => s.me)!;
  const [filter, setFilter] = useState('');
  const canRoles = has(data.myPermissions, P.MANAGE_ROLES);
  const myTop = data.server!.owner_id === me.id ? Infinity : (data.topRole(me.id)?.position ?? 0);
  const assignable = data.roles.filter((r) => !r.is_default && r.position < myTop);

  useEffect(() => {
    loadProfiles(data.members.map((m) => m.user_id));
  }, [data.members]);

  const list = data.members.filter((m) => {
    const p = getProfile(m.user_id);
    const q = filter.toLowerCase();
    return !q || p?.username.includes(q) || p?.display_name.toLowerCase().includes(q) || m.nickname?.toLowerCase().includes(q);
  });

  async function toggleRole(userId: string, roleId: string, on: boolean) {
    const res = on
      ? await supabase.from('member_roles').insert({ server_id: data.server!.id, user_id: userId, role_id: roleId })
      : await supabase.from('member_roles').delete().eq('server_id', data.server!.id).eq('user_id', userId).eq('role_id', roleId);
    if (res.error) alert(errorMessage(res.error));
    data.reload();
  }

  async function kick(userId: string) {
    if (!confirm(`Kick ${displayName(userId)}?`)) return;
    const { error } = await supabase.from('server_members').delete().eq('server_id', data.server!.id).eq('user_id', userId);
    if (error) alert(errorMessage(error));
    data.reload();
  }

  async function ban(userId: string) {
    const reason = prompt(`Ban ${displayName(userId)}? Optional reason:`);
    if (reason === null) return;
    const { error } = await supabase.from('bans').insert({ server_id: data.server!.id, user_id: userId, banned_by: me.id, reason });
    if (error) alert(errorMessage(error));
    data.reload();
  }

  return (
    <div>
      <input className="search" placeholder="Search members" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="member-table">
        {list.map((m) => {
          const roles = data.rolesOf(m.user_id);
          const theirTop = data.server!.owner_id === m.user_id ? Infinity : (roles[0]?.position ?? 0);
          const outranked = theirTop < myTop && m.user_id !== me.id;
          return (
            <div key={m.user_id} className="member-row">
              <Avatar profile={getProfile(m.user_id)} size={32} />
              <div className="member-row-name">
                <b>{displayName(m.user_id, m.nickname)}</b>
                <span className="small muted">@{getProfile(m.user_id)?.username}</span>
              </div>
              <div className="member-row-roles">
                {roles.map((r) => (
                  <span key={r.id} className="role-pill">
                    <span className="role-dot" style={{ background: r.color }} />
                    {r.name}
                    {canRoles && r.position < myTop && (
                      <button className="pill-x" onClick={() => toggleRole(m.user_id, r.id, false)} title="Remove role">
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {canRoles && (
                  <select
                    className="add-role"
                    value=""
                    onChange={(e) => e.target.value && toggleRole(m.user_id, e.target.value, true)}
                  >
                    <option value="">+ role</option>
                    {assignable
                      .filter((r) => !roles.some((x) => x.id === r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              {outranked && has(data.myPermissions, P.KICK_MEMBERS) && (
                <button className="btn danger small" onClick={() => kick(m.user_id)}>
                  Kick
                </button>
              )}
              {outranked && has(data.myPermissions, P.BAN_MEMBERS) && (
                <button className="btn danger small" onClick={() => ban(m.user_id)}>
                  Ban
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Invites({ data }: { data: ServerData }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('invites').select('*').eq('server_id', data.server!.id).order('created_at', { ascending: false });
    setInvites((rows ?? []) as Invite[]);
    loadProfiles((rows ?? []).map((r) => r.created_by));
  }, [data.server]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="member-table">
      {!invites.length && <p className="muted">No active invites.</p>}
      {invites.map((i) => (
        <div key={i.code} className="member-row">
          <code>{i.code}</code>
          <span className="small muted">by {displayName(i.created_by)}</span>
          <span className="small">
            {i.uses}
            {i.max_uses ? `/${i.max_uses}` : ''} uses
          </span>
          <span className="small muted">{i.expires_at ? `expires ${new Date(i.expires_at).toLocaleString()}` : 'never expires'}</span>
          <button
            className="btn danger small"
            onClick={async () => {
              await supabase.from('invites').delete().eq('code', i.code);
              load();
            }}
          >
            Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

function Bans({ data }: { data: ServerData }) {
  const [bans, setBans] = useState<Ban[]>([]);
  const load = useCallback(async () => {
    const { data: rows } = await supabase.from('bans').select('*').eq('server_id', data.server!.id);
    setBans((rows ?? []) as Ban[]);
  }, [data.server]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="member-table">
      {!bans.length && <p className="muted">Nobody is banned.</p>}
      {bans.map((b) => (
        <div key={b.user_id} className="member-row">
          <span>{getProfile(b.user_id)?.display_name ?? b.user_id.slice(0, 8)}</span>
          <span className="small muted">{b.reason || 'No reason'}</span>
          <button
            className="btn secondary small"
            onClick={async () => {
              await supabase.from('bans').delete().eq('server_id', b.server_id).eq('user_id', b.user_id);
              load();
            }}
          >
            Unban
          </button>
        </div>
      ))}
    </div>
  );
}
