import { useCallback, useEffect, useState } from 'react';
import { IntegrationsTab, VoogleTab } from './ServerSettingsBots';
import { AuditLogTab, ServerReportsTab } from './ReportViews';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { has, P, PERMISSION_GROUPS, PERMISSION_INFO } from '../lib/permissions';
import type { Ban, Role } from '../lib/types';
import { openServer, type ServerData } from '../hooks/data';
import { Avatar, ColorPicker, Field, Icon, Modal } from './ui';
import { askConfirm, askText } from './Dialogs';
import { showUndo } from './Undo';
import { DiscoveryTab, ExpressionsTab, InvitesTab, JoiningTab, ThemeTab } from './ServerSettingsExtra';
import { Select } from './Select';

type Tab = 'overview' | 'roles' | 'members' | 'invites' | 'bans' | 'expressions' | 'theme' | 'joining' | 'discovery' | 'integrations' | 'voogle' | 'reports' | 'audit';

export function ServerSettingsModal({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const p = data.myPermissions;
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Overview', has(p, P.MANAGE_SERVER)],
    ['theme', 'Server Theme', has(p, P.MANAGE_SERVER)],
    ['joining', 'Welcome, Rules & Joining', has(p, P.MANAGE_SERVER)],
    ['roles', 'Roles', has(p, P.MANAGE_ROLES) || true],
    ['expressions', 'Emoji, GIFs & Sounds', true],
    ['members', 'Members', true],
    ['invites', 'Invites', has(p, P.MANAGE_SERVER)],
    ['discovery', 'Discovery', has(p, P.MANAGE_SERVER)],
    ['integrations', 'Integrations & Bots', has(p, P.MANAGE_INTEGRATIONS) || has(p, P.MANAGE_SERVER)],
    ['voogle', 'Voogle', has(p, P.MANAGE_SERVER)],
    ['bans', 'Bans', has(p, P.BAN_MEMBERS)],
    ['reports', 'Reports', has(p, P.MODERATE_MEMBERS) || has(p, P.MANAGE_MESSAGES) || has(p, P.KICK_MEMBERS)],
    ['audit', 'Audit Log', has(p, P.VIEW_AUDIT_LOG)],
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
          {tab === 'invites' && <InvitesTab data={data} />}
          {tab === 'expressions' && <ExpressionsTab data={data} />}
          {tab === 'theme' && <ThemeTab data={data} />}
          {tab === 'integrations' && <IntegrationsTab data={data} />}
          {tab === 'reports' && <ServerReportsTab data={data} onClose={onClose} />}
          {tab === 'audit' && <AuditLogTab data={data} />}
          {tab === 'voogle' && <VoogleTab data={data} />}
          {tab === 'joining' && <JoiningTab data={data} />}
          {tab === 'discovery' && <DiscoveryTab data={data} />}
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
      <div className="asset-row">
        <ServerImagePicker data={data} kind="icon" />
        <ServerImagePicker data={data} kind="banner" />
      </div>
      <Field label="Icon color (shown when there's no icon picture)">
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
          <Select
            value={welcome}
            onChange={setWelcome}
            options={[{ value: '', label: 'No join messages' }, ...data.channels.filter((c) => c.type === 'text').map((c) => ({ value: c.id, label: `#${c.name}` }))]}
          />
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
            <Select
              value={newOwner}
              onChange={setNewOwner}
              placeholder="Choose a member…"
              searchable
              options={data.members.filter((m) => m.user_id !== me.id).map((m) => ({ value: m.user_id, label: displayName(m.user_id, m.nickname), hint: `@${getProfile(m.user_id)?.username ?? ''}` }))}
            />
            <button
              className="btn danger"
              disabled={!newOwner}
              onClick={async () => {
                if (!(await askConfirm({ title: 'Transfer ownership', body: `${displayName(newOwner)} becomes the owner and you lose owner rights. This can’t be undone by you.`, confirm: 'Transfer Ownership', danger: true }))) return;
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
              const typed = await askText({
                title: `Delete ${server.name}`,
                label: `Type the server name (${server.name}) to delete it`,
                hint: 'You can restore it from Settings → Security for 7 days. After that it’s gone for good.',
                maxLength: 100,
              });
              if (typed !== server.name) return;
              const { error } = await supabase.rpc('delete_server', { p_server: server.id });
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
  const sorted = [...data.roles].sort((a, b) => (a.is_default ? 1 : b.is_default ? -1 : b.position - a.position));
  const [selected, setSelected] = useState<string | null>(sorted[0]?.id ?? null);
  const role = data.roles.find((r) => r.id === selected) ?? null;
  const myTop = data.server!.owner_id === me.id ? Infinity : (data.topRole(me.id)?.position ?? 0);
  const canManage = has(data.myPermissions, P.MANAGE_ROLES);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: 'before' | 'after' } | null>(null);
  const movable = (r: Role) => canManage && !r.is_default && r.position < myTop;

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

  async function drop(targetId: string, where: 'before' | 'after') {
    if (!drag || drag === targetId) return;
    // only the roles you can move are reordered; they stay below your own top role
    const list = sorted.filter(movable).map((r) => r.id).filter((id) => id !== drag);
    let i = list.indexOf(targetId);
    if (i === -1) i = where === 'before' ? 0 : list.length;
    else if (where === 'after') i++;
    list.splice(i, 0, drag);
    const before = sorted.filter(movable).map((r) => r.id);
    const { error } = await supabase.rpc('reorder_roles', { p_server: data.server!.id, p_ids: list });
    if (error) return alert(errorMessage(error));
    data.reload();
    showUndo('Role order changed', async () => {
      await supabase.rpc('reorder_roles', { p_server: data.server!.id, p_ids: before });
      data.reload();
    });
  }

  return (
    <div className="roles-layout">
      <div className="roles-list" role="list">
        {canManage && (
          <button className="btn secondary small full" onClick={create}>
            + Create Role
          </button>
        )}
        <p className="small muted roles-hint">Drag roles to reorder. Higher roles can manage the ones below them.</p>
        {sorted.map((r) => (
          <div
            key={r.id}
            role="listitem"
            className={`role-item${selected === r.id ? ' active' : ''}${drag === r.id ? ' dragging' : ''}${over?.id === r.id ? ` drop-${over.where}` : ''}`}
            onClick={() => setSelected(r.id)}
            draggable={movable(r)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', r.id);
              setDrag(r.id);
            }}
            onDragEnd={() => (setDrag(null), setOver(null))}
            onDragOver={(e) => {
              if (!drag || drag === r.id || r.is_default) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setOver({ id: r.id, where: e.clientY < box.top + box.height / 2 ? 'before' : 'after' });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (over) drop(over.id, over.where);
              setDrag(null);
              setOver(null);
            }}
          >
            {movable(r) && (
              <span className="role-grip" aria-hidden>
                <Icon name="grip" size={14} />
              </span>
            )}
            <span className="role-dot" style={{ background: r.color2 ? `linear-gradient(135deg, ${r.color}, ${r.color2})` : r.color }} />
            {r.icon && <span className="role-icon">{r.icon}</span>}
            <span className="grow ellipsis">{r.name}</span>
            {!movable(r) && !r.is_default && <Icon name="lock" size={12} />}
            <span className="small muted">{data.members.filter((m) => r.is_default || data.rolesOf(m.user_id).some((x) => x.id === r.id)).length}</span>
          </div>
        ))}
      </div>
      {role && <RoleEditor key={role.id} role={role} data={data} editable={canManage && (role.is_default || role.position < myTop)} />}
    </div>
  );
}

function RoleEditor({ role, data, editable }: { role: Role; data: ServerData; editable: boolean }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [color2, setColor2] = useState<string | null>(role.color2 ?? null);
  const [icon, setIcon] = useState(role.icon ?? '');
  const [description, setDescription] = useState(role.description ?? '');
  const [mentionable, setMentionable] = useState(role.mentionable ?? true);
  const [perms, setPerms] = useState(role.permissions);
  const [hoist, setHoist] = useState(role.hoist);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mine = data.myPermissions;
  const dirty =
    name !== role.name || color !== role.color || color2 !== (role.color2 ?? null) || icon !== (role.icon ?? '') || description !== (role.description ?? '') ||
    mentionable !== (role.mentionable ?? true) || perms !== role.permissions || hoist !== role.hoist;

  async function save() {
    const patch = role.is_default
      ? { permissions: perms }
      : { name: name.trim(), color, color2, icon: icon.trim() || null, description: description.trim(), mentionable, permissions: perms, hoist };
    const { error } = await supabase.from('roles').update(patch).eq('id', role.id);
    setMsg(error ? errorMessage(error) : 'Saved.');
    data.reload();
  }

  return (
    <div className="role-editor">
      {msg && <div className="notice">{msg}</div>}
      {!editable && <div className="warning-box">This role is above your highest role (or you don’t have Manage Roles), so you can’t edit it.</div>}
      <fieldset disabled={!editable}>
        {!role.is_default && (
          <div className="role-preview">
            <span className="role-preview-name" style={color2 ? { backgroundImage: `linear-gradient(90deg, ${color}, ${color2})` } : { color }}>
              {icon && <span className="role-icon">{icon}</span>}
              {name || 'Role'}
            </span>
            <span className="small muted">how names with this role look</span>
          </div>
        )}
        <Field label="Role name">
          <input maxLength={100} value={name} disabled={role.is_default} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!role.is_default && (
          <>
            <div className="row">
              <Field label="Color">
                <ColorPicker value={color} onChange={setColor} />
              </Field>
              <Field label="Gradient" aside={color2 ? <button type="button" className="btn link small" onClick={() => setColor2(null)}>Solid</button> : <button type="button" className="btn link small" onClick={() => setColor2('#ffffff')}>Add gradient</button>}>
                {color2 ? <ColorPicker value={color2} onChange={setColor2} /> : <span className="small muted">Solid color</span>}
              </Field>
            </div>
            <div className="row">
              <Field label="Role icon" hint="an emoji, shown next to names">
                <input maxLength={16} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="⭐" />
              </Field>
              <Field label="Description">
                <input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Helps keep the server friendly" />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={hoist} onChange={(e) => setHoist(e.target.checked)} />
              Show members with this role separately in the member list
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={mentionable} onChange={(e) => setMentionable(e.target.checked)} />
              Anyone can @mention this role
            </label>
          </>
        )}
        <div className="perm-head">
          <h3>Permissions</h3>
          <input className="search-input" placeholder="Search permissions" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn link small" onClick={() => setPerms(0)}>
            Clear all
          </button>
        </div>
        {PERMISSION_GROUPS.map((g) => {
          const items = PERMISSION_INFO.filter((pi) => pi.group === g && (!q || `${pi.name} ${pi.description}`.toLowerCase().includes(q.toLowerCase())));
          if (!items.length) return null;
          return (
            <section key={g} className="perm-group">
              <h4>{g}</h4>
              <div className="perm-list">
                {items.map((pi) => (
                  <label key={pi.bit} className={`perm${!has(mine, pi.bit) ? ' locked' : ''}${pi.dangerous ? ' dangerous' : ''}`}>
                    <div>
                      <b>
                        {pi.name}
                        {pi.dangerous && <span className="perm-danger">careful</span>}
                      </b>
                      <div className="small muted">{pi.description}</div>
                      {!has(mine, pi.bit) && <div className="small muted">You can’t give a permission you don’t have yourself.</div>}
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
            </section>
          );
        })}
        <div className="modal-actions sticky-actions">
          {!role.is_default && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!(await askConfirm({ title: `Delete ${role.name}`, body: 'Members lose this role and its permissions.', confirm: 'Delete Role', danger: true }))) return;
                const { error } = await supabase.from('roles').delete().eq('id', role.id);
                if (error) setMsg(errorMessage(error));
                data.reload();
              }}
            >
              Delete Role
            </button>
          )}
          {dirty && <span className="small muted">Unsaved changes</span>}
          <button type="button" className="btn primary" disabled={!dirty} onClick={save}>
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
    if (!(await askConfirm({ title: `Kick ${displayName(userId)}`, body: 'They can come back with a new invite.', confirm: 'Kick', danger: true }))) return;
    const { error } = await supabase.from('server_members').delete().eq('server_id', data.server!.id).eq('user_id', userId);
    if (error) alert(errorMessage(error));
    data.reload();
  }

  async function ban(userId: string) {
    const reason = await askText({ title: `Ban ${displayName(userId)}`, label: 'Reason (optional, shown to them if they try to rejoin)', maxLength: 500 });
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
                  <Select
                    className="add-role"
                    value=""
                    placeholder="+ role"
                    onChange={(v) => v && toggleRole(m.user_id, v, true)}
                    options={assignable.filter((r) => !roles.some((x) => x.id === r.id)).map((r) => ({ value: r.id, label: r.name, icon: <span className="role-dot" style={{ background: r.color ?? 'var(--muted)' }} /> }))}
                  />
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

/** Shrink a picture on this device before uploading (GIFs are kept as-is so they stay animated). */
async function prepareImage(file: File, maxW: number, maxH: number, square: boolean): Promise<Blob> {
  if (file.type === 'image/gif') {
    if (file.size > 4 * 1024 * 1024) throw new Error('Animated GIFs must be under 4 MB.');
    return file;
  }
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('That file isn’t a picture we can read. Try a PNG, JPG, GIF or WebP.');
  });
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (square) {
    const side = Math.min(bmp.width, bmp.height);
    sx = (bmp.width - side) / 2;
    sy = (bmp.height - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, maxW / sw, maxH / sh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that picture.'))), 'image/webp', 0.9));
}

function ServerImagePicker({ data, kind }: { data: ServerData; kind: 'icon' | 'banner' }) {
  const server = data.server!;
  const current = kind === 'icon' ? server.icon_url : server.banner_url;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const blob = await prepareImage(file, kind === 'icon' ? 256 : 1280, kind === 'icon' ? 256 : 720, kind === 'icon');
      const ext = blob.type === 'image/gif' ? 'gif' : 'webp';
      const path = `${server.id}/${kind}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('server-assets').upload(path, blob, { contentType: blob.type, upsert: true });
      if (upErr) throw upErr;
      const url = supabase.storage.from('server-assets').getPublicUrl(path).data.publicUrl;
      const { error: dbErr } = await supabase.from('servers').update(kind === 'icon' ? { icon_url: url } : { banner_url: url }).eq('id', server.id);
      if (dbErr) throw dbErr;
      // tidy up the previous picture
      const old = current?.split('/server-assets/')[1];
      if (old) supabase.storage.from('server-assets').remove([decodeURIComponent(old)]);
      data.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await supabase.from('servers').update(kind === 'icon' ? { icon_url: null } : { banner_url: null }).eq('id', server.id);
    const old = current?.split('/server-assets/')[1];
    if (old) supabase.storage.from('server-assets').remove([decodeURIComponent(old)]);
    data.reload();
  }

  return (
    <div className={`asset-picker ${kind}`}>
      <div className="field-label">{kind === 'icon' ? 'Server icon' : 'Server banner'}</div>
      <label className="asset-preview" style={{ background: current ? undefined : kind === 'icon' ? server.icon_color : (server.banner_color ?? 'var(--bg-3)') }}>
        {current ? <img src={current} alt="" /> : <span>{kind === 'icon' ? server.name.slice(0, 2).toUpperCase() : 'No banner'}</span>}
        <span className="asset-overlay">{busy ? 'Uploading…' : 'Change'}</span>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden disabled={busy} onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
      </label>
      <div className="small muted">{kind === 'icon' ? 'Square, at least 256×256.' : 'Wide, 16:9 looks best.'}</div>
      {current && (
        <button type="button" className="btn link small" onClick={remove}>
          Remove
        </button>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
