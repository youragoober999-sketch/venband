// Settings → Profile → Your badges: choose which badges show and in what order.
// Staff badges always show (people must be able to recognise real staff).
import { useEffect, useMemo, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { putProfile } from '../lib/directory';
import { BadgeIcon, CATEGORY_LABEL, RARITY_LABEL, useAllBadges, type BadgeDef } from './Badges';
import { Field, Icon } from './ui';

function BadgeRow({ d, children }: { d: BadgeDef; children?: React.ReactNode }) {
  return (
    <li className="badge-pick-row">
      <BadgeIcon def={d} size={28} />
      <span className="grow">
        <b>{d.label}</b>
        <span className="small muted">
          {[d.rarity && RARITY_LABEL[d.rarity], d.category && CATEGORY_LABEL[d.category]].filter(Boolean).join(' · ')}
          {d.description ? ` — ${d.description}` : ''}
        </span>
      </span>
      {children}
    </li>
  );
}

export function BadgeDisplayPicker() {
  const me = sessionStore.use((s) => s.me)!;
  const all = useAllBadges();
  const held = useMemo(() => all.filter((b) => me.badges?.includes(b.id)), [all, me.badges]);
  const prot = held.filter((b) => b.protected);
  const others = held.filter((b) => !b.protected);
  const saved = useMemo(
    () => (me.badge_display ?? others.map((b) => b.id)).filter((id) => others.some((b) => b.id === id)),
    [me.badge_display, others],
  );
  const [order, setOrder] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setOrder(saved), [saved]);

  if (!held.length) return null;
  const shown = order.map((id) => others.find((b) => b.id === id)!).filter(Boolean);
  const hidden = others.filter((b) => !order.includes(b.id));
  const dirty = order.join() !== saved.join();
  const move = (i: number, by: number) =>
    setOrder((o) => {
      const n = [...o];
      const j = i + by;
      if (j < 0 || j >= n.length) return o;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const store = async (ids: string[] | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc('set_badge_display', { p_ids: ids });
      if (error) throw error;
      const next = { ...me, badge_display: (data as string[] | null) ?? null };
      sessionStore.set({ me: next });
      putProfile(next);
      setMsg({ ok: true, text: ids === null ? 'Showing all your badges.' : 'Saved — this is how your badges appear everywhere.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="Your badges" group hint="Pick which badges show next to your name, and their order. Venband team badges always show.">
      <div className="badge-pick">
        {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
        {prot.length > 0 && (
          <ul className="badge-pick-list">
            {prot.map((d) => (
              <BadgeRow key={d.id} d={d}>
                <span className="small muted">Always shown</span>
              </BadgeRow>
            ))}
          </ul>
        )}
        <ul className="badge-pick-list">
          {shown.map((d, i) => (
            <BadgeRow key={d.id} d={d}>
              <button type="button" className="icon-btn" aria-label={`Move ${d.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="chevron" size={14} />
              </button>
              <button type="button" className="icon-btn badge-pick-down" aria-label={`Move ${d.label} down`} disabled={i === shown.length - 1} onClick={() => move(i, 1)}>
                <Icon name="chevron" size={14} />
              </button>
              <button type="button" className="btn link small" onClick={() => setOrder((o) => o.filter((x) => x !== d.id))}>
                Hide
              </button>
            </BadgeRow>
          ))}
        </ul>
        {hidden.length > 0 && (
          <>
            <div className="small muted badge-pick-sub">Hidden</div>
            <ul className="badge-pick-list hidden-badges">
              {hidden.map((d) => (
                <BadgeRow key={d.id} d={d}>
                  <button type="button" className="btn link small" onClick={() => setOrder((o) => [...o, d.id])}>
                    Show
                  </button>
                </BadgeRow>
              ))}
            </ul>
          </>
        )}
        {others.length > 0 && (
          <div className="row-start">
            <button type="button" className="btn primary small" disabled={!dirty || busy} onClick={() => store(order)}>
              {busy ? 'Saving…' : 'Save badge order'}
            </button>
            {me.badge_display && (
              <button type="button" className="btn link small" disabled={busy} onClick={() => store(null)}>
                Show all
              </button>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}
