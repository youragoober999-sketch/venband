import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { displayName, getProfile, loadProfiles } from '../lib/directory';
import { has, OVERRIDABLE_PERMISSIONS, P, PERMISSION_INFO } from '../lib/permissions';
import type { Ban, Invite, Role } from '../lib/types';

type ChannelRow = ServerData['channels'][number];
type Override = { role_id: string; allow: number; deny: number };
import { openServer, type ServerData } from '../hooks/data';
import { Avatar, ColorPicker, Field, Modal } from './ui';

type Tab = 'overview' | 'roles' | 'channels' | 'members' | 'invites' | 'bans';

export function ServerSettingsModal({ data, onClose }: { data: ServerData; onClose: () => void }) {
  const p = data.myPermissions;
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Overview', has(p, P.MANAGE_SERVER)],
    ['roles', 'Roles', has(p, P.MANAGE_ROLES)],
    ['channels', 'Channels', has(p, P.MANAGE_CHANNELS)],
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
          {tab === 'channels' && <Channels data={data} />}
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
  const canReorder = has(data.myPermissions, P.MANAGE_ROLES);
  // highest position first, like the editor's "higher = more powerful"
  const ordered = [...data.roles].sort((a, b) => b.position - a.position);
  const [dragId, setDragId] = useState<string | null>(null);

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

  async function dropOn(targetId: string) {
    if (!dragId || dragId === targetId || !canReorder) return setDragId(null);
    const draggedRole = data.roles.find((r) => r.id === dragId);
    const targetRole = data.roles.find((r) => r.id === targetId);
    if (!draggedRole || !targetRole || draggedRole.is_default || targetRole.is_default) return setDragId(null);
    // only reorder roles you're allowed to edit (below your own highest role)
    if (draggedRole.position >= myTop || targetRole.position >= myTop) {
      setDragId(null);
      return alert('You can only reorder roles below your own highest role.');
    }
    const next = ordered.filter((r) => r.id !== dragId);
    const targetIndex = next.findIndex((r) => r.id === targetId);
    next.splice(targetIndex, 0, draggedRole);
    // re-number from the top, skipping @everyone which always stays at 0
    const movable = next.filter((r) => !r.is_default);
    const top = movable.length;
    const updates = movable
      .map((r, i) => ({ id: r.id, position: top - i }))
      .filter((u) => data.roles.find((r) => r.id === u.id)!.position !== u.position);
    setDragId(null);
    if (!updates.length) return;
    const { error } = await Promise.all(updates.map((u) => supabase.from('roles').update({ position: u.position }).eq('id', u.id))).then(
      (results) => ({ error: results.find((r) => r.error)?.error ?? null }),
    );
    if (error) alert(errorMessage(error));
    data.reload();
  }

  return (
    <div className="roles-layout">
      <div className="roles-list">
        <button className="btn secondary small full" onClick={create}>
          + Create Role
        </button>
        {ordered.map((r) => (
          <button
            key={r.id}
            className={`role-item${selected === r.id ? ' active' : ''}${dragId === r.id ? ' dragging' : ''}`}
            draggable={canReorder && !r.is_default}
            onClick={() => setSelected(r.id)}
            onDragStart={() => setDragId(r.id)}
            onDragOver={(e) => canReorder && !r.is_default && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(r.id);
            }}
            onDragEnd={() => setDragId(null)}
          >
            {canReorder && !r.is_default && <span className="drag-handle" aria-hidden>⠿</span>}
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

type CatGroup = { category: string; channels: ChannelRow[] };

function groupByCategory(channels: ChannelRow[]): CatGroup[] {
  const sorted = [...channels].sort((a, b) => a.position - b.position);
  const groups: CatGroup[] = [];
  for (const c of sorted) {
    let g = groups.find((g) => g.category === (c.category || ''));
    if (!g) {
      g = { category: c.category || '', channels: [] };
      groups.push(g);
    }
    g.channels.push(c);
  }
  return groups;
}

function flattenPositions(groups: CatGroup[]): { id: string; category: string; position: number }[] {
  const out: { id: string; category: string; position: number }[] = [];
  let pos = 0;
  for (const g of groups) for (const c of g.channels) out.push({ id: c.id, category: g.category, position: pos++ });
  return out;
}

function Channels({ data }: { data: ServerData }) {
  const canManage = has(data.myPermissions, P.MANAGE_CHANNELS);
  const [groups, setGroups] = useState<CatGroup[]>(() => groupByCategory(data.channels));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{ kind: 'channel' | 'category'; id: string; label: string } | null>(null);
  const dragItem = useRef<{ type: 'channel' | 'category'; catIndex: number; chanIndex?: number } | null>(null);

  useEffect(() => {
    if (!dirty) setGroups(groupByCategory(data.channels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.channels]);

  function moveChannel(fromCat: number, fromChan: number, toCat: number, toChan: number) {
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, channels: [...g.channels] }));
      const [moved] = next[fromCat].channels.splice(fromChan, 1);
      next[toCat].channels.splice(toChan, 0, moved);
      return next;
    });
    setDirty(true);
  }

  function moveCategory(from: number, to: number) {
    setGroups((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDirty(true);
  }

  async function save() {
    const updates = flattenPositions(groups);
    const changed = updates.filter((u) => {
      const orig = data.channels.find((c) => c.id === u.id)!;
      return orig.position !== u.position || (orig.category || '') !== u.category;
    });
    if (!changed.length) return setDirty(false);
    const results = await Promise.all(
      changed.map((u) => supabase.from('channels').update({ position: u.position, category: u.category }).eq('id', u.id)),
    );
    const error = results.find((r) => r.error)?.error;
    setMsg(error ? errorMessage(error) : 'Saved.');
    setDirty(false);
    data.reload();
  }

  return (
    <div>
      {msg && <div className="notice">{msg}</div>}
      {!canManage && <div className="warning-box">You need Manage Channels to reorder or edit permissions here.</div>}
      <p className="small muted">
        Drag the handle to reorder categories and channels, or move a channel into a different category. Click the lock icon to set
        which roles can do what inside a category or channel — these overrides sit on top of the role's server-wide permissions.
      </p>
      <div className="channels-tree">
        {groups.map((g, ci) => (
          <div
            key={g.category || `__none_${ci}`}
            className="category-block"
            onDragOver={(e) => {
              if (dragItem.current?.type === 'category') e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragItem.current?.type === 'category' && canManage) moveCategory(dragItem.current.catIndex, ci);
              dragItem.current = null;
            }}
          >
            <div className="category-header">
              {canManage && (
                <span
                  className="drag-handle"
                  draggable
                  onDragStart={() => (dragItem.current = { type: 'category', catIndex: ci })}
                  aria-hidden
                >
                  ⠿
                </span>
              )}
              <b>{g.category || 'No category'}</b>
              {canManage && g.category && (
                <button
                  className="icon-btn small"
                  title="Permission overrides for this category"
                  onClick={() => setOverrideTarget({ kind: 'category', id: g.category, label: g.category })}
                >
                  🔒
                </button>
              )}
            </div>
            <div
              className="category-channels"
              onDragOver={(e) => {
                if (dragItem.current?.type === 'channel') e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const item = dragItem.current;
                if (item?.type === 'channel' && canManage && item.chanIndex !== undefined) {
                  moveChannel(item.catIndex, item.chanIndex, ci, g.channels.length);
                }
                dragItem.current = null;
              }}
            >
              {!g.channels.length && <div className="small muted empty-cat">Drop a channel here</div>}
              {g.channels.map((c, chi) => (
                <div
                  key={c.id}
                  className="channel-row"
                  onDragOver={(e) => {
                    if (dragItem.current?.type === 'channel') e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = dragItem.current;
                    if (item?.type === 'channel' && canManage && item.chanIndex !== undefined) {
                      moveChannel(item.catIndex, item.chanIndex, ci, chi);
                    }
                    dragItem.current = null;
                  }}
                >
                  {canManage && (
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={() => (dragItem.current = { type: 'channel', catIndex: ci, chanIndex: chi })}
                      aria-hidden
                    >
                      ⠿
                    </span>
                  )}
                  <span className="channel-type-icon">{c.type === 'voice' ? '🔊' : '#'}</span>
                  <span className="grow">{c.name}</span>
                  {c.is_private && <span className="small muted">private</span>}
                  {canManage && (
                    <button
                      className="icon-btn small"
                      title="Permission overrides for this channel"
                      onClick={() => setOverrideTarget({ kind: 'channel', id: c.id, label: c.name })}
                    >
                      🔒
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {canManage && dirty && (
        <div className="modal-actions">
          <button className="btn secondary" onClick={() => (setGroups(groupByCategory(data.channels)), setDirty(false))}>
            Discard
          </button>
          <button className="btn primary" onClick={save}>
            Save Order
          </button>
        </div>
      )}
      {overrideTarget && <OverridesEditor data={data} target={overrideTarget} onClose={() => setOverrideTarget(null)} />}
    </div>
  );
}

/** Per-role allow/deny editor for one channel or category, Discord-style. */
function OverridesEditor({
  data,
  target,
  onClose,
}: {
  data: ServerData;
  target: { kind: 'channel' | 'category'; id: string; label: string };
  onClose: () => void;
}) {
  const table = target.kind === 'channel' ? 'channel_overrides' : 'category_overrides';
  const [rows, setRows] = useState<Record<string, Override>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q =
        target.kind === 'channel'
          ? supabase.from('channel_overrides').select('role_id, allow, deny').eq('channel_id', target.id)
          : supabase.from('category_overrides').select('role_id, allow, deny').eq('server_id', data.server!.id).eq('category', target.id);
      const { data: res, error } = await q;
      if (cancelled) return;
      if (error) setMsg(errorMessage(error));
      const map: Record<string, Override> = {};
      for (const r of res ?? []) map[r.role_id] = r as Override;
      setRows(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [target.id, target.kind, data.server]);

  function stateOf(roleId: string, bit: number): 'inherit' | 'allow' | 'deny' {
    const r = rows[roleId];
    if (!r) return 'inherit';
    if (r.allow & bit) return 'allow';
    if (r.deny & bit) return 'deny';
    return 'inherit';
  }

  function cycle(roleId: string, bit: number) {
    setRows((prev) => {
      const cur = prev[roleId] ?? { role_id: roleId, allow: 0, deny: 0 };
      const state = stateOf(roleId, bit);
      // inherit -> allow -> deny -> inherit
      const next =
        state === 'inherit'
          ? { ...cur, allow: cur.allow | bit, deny: cur.deny & ~bit }
          : state === 'allow'
            ? { ...cur, allow: cur.allow & ~bit, deny: cur.deny | bit }
            : { ...cur, allow: cur.allow & ~bit, deny: cur.deny & ~bit };
      return { ...prev, [roleId]: next };
    });
  }

  async function save() {
    const payload = Object.values(rows);
    const base = target.kind === 'channel' ? { channel_id: target.id } : { server_id: data.server!.id, category: target.id };
    const toUpsert = payload.filter((r) => r.allow || r.deny).map((r) => ({ ...base, role_id: r.role_id, allow: r.allow, deny: r.deny }));
    const toDelete = payload.filter((r) => !r.allow && !r.deny).map((r) => r.role_id);
    const onConflict = target.kind === 'channel' ? 'channel_id,role_id' : 'server_id,category,role_id';
    if (toUpsert.length) {
      const { error } = await supabase.from(table).upsert(toUpsert, { onConflict });
      if (error) return setMsg(errorMessage(error));
    }
    for (const roleId of toDelete) {
      const q =
        target.kind === 'channel'
          ? supabase.from('channel_overrides').delete().eq('channel_id', target.id).eq('role_id', roleId)
          : supabase.from('category_overrides').delete().eq('server_id', data.server!.id).eq('category', target.id).eq('role_id', roleId);
      const { error } = await q;
      if (error) return setMsg(errorMessage(error));
    }
    setMsg('Saved.');
    data.reload();
  }

  return (
    <Modal title={`Permission overrides — ${target.kind === 'channel' ? '#' : ''}${target.label}`} onClose={onClose} wide>
      {msg && <div className="notice">{msg}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="overrides-table">
          <p className="small muted">
            Click a cell to cycle: inherit (role's server permission) → allow → deny → inherit. {target.kind === 'category' ? 'Category overrides apply before, and get overridden by, that channel\'s own overrides.' : 'Channel overrides apply last and win.'}
          </p>
          <table>
            <thead>
              <tr>
                <th>Role</th>
                {OVERRIDABLE_PERMISSIONS.map((pi) => (
                  <th key={pi.bit} title={pi.description}>
                    {pi.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="role-dot" style={{ background: r.color }} />
                    {r.name}
                  </td>
                  {OVERRIDABLE_PERMISSIONS.map((pi) => {
                    const s = stateOf(r.id, pi.bit);
                    return (
                      <td key={pi.bit}>
                        <button
                          type="button"
                          className={`override-cell ${s}`}
                          title={s}
                          onClick={() => cycle(r.id, pi.bit)}
                        >
                          {s === 'allow' ? '✓' : s === 'deny' ? '✕' : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="modal-actions">
            <button className="btn primary" onClick={save}>
              Save Overrides
            </button>
          </div>
        </div>
      )}
    </Modal>
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