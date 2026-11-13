// Settings → Special: the owner-only Sovereign set. Only accounts with the
// owner role see this tab; the database refuses these items for anyone else
// (20261106160000_owner_special.sql).
import { useState, type ReactNode } from 'react';
import { sessionStore, updateMyProfile } from '../lib/session';
import { useSettings } from '../lib/settings';
import { errorMessage } from '../lib/supabase';
import { ITEMS, SPECIAL_EFFECTS, SPECIAL_NAME_EFFECT, type ShopKind } from '../lib/shop';
import { equip, shopTheme } from '../lib/inventory';
import type { Profile } from '../lib/types';
import { NameplateArt, ProfileEffect } from './Cosmetics';
import { ProfilePreview } from './Shop';
import { ThemeSwatch } from './ThemeStudio';
import { Avatar, Icon, StyledName } from './ui';
import './special.css';

type Piece = { id: string; kind: ShopKind | 'name'; title: string; blurb: string };
const PIECES: Piece[] = [
  { id: 'effect.sovereign.owner', kind: 'effect', title: 'Genesis', blurb: 'Profile effect — a living vortex around the Venband sigil: light pours in, shockwaves ripple out, lightning cracks the edges.' },
  { id: 'deco.sovereign.owner', kind: 'decoration', title: 'Sovereign Halo', blurb: 'Avatar decoration — counter-rotating rune rings, a crown of light, orbiting gems and the Venband seal.' },
  { id: 'plate.sovereign.owner', kind: 'nameplate', title: 'Throne Room', blurb: 'Nameplate — gold filigree, violet light and drifting sigils behind your name.' },
  { id: 'name', kind: 'name', title: 'Sovereign Name', blurb: 'Name style — molten gold with violet light running through it, and a spark.' },
  { id: 'theme.sovereign', kind: 'theme', title: 'Sovereign Theme', blurb: 'App theme — deep violet and gold over a glass wallpaper of light.' },
];

export function SpecialTab() {
  const me = sessionStore.use((s) => s.me)!;
  const themeId = useSettings((s) => s.themeId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wearing = (p: Piece) =>
    p.kind === 'name' ? me.name_style?.effect === SPECIAL_NAME_EFFECT
      : p.kind === 'decoration' ? me.avatar_frame === p.id
        : p.kind === 'effect' ? me.profile_effect === p.id
          : p.kind === 'nameplate' ? me.nameplate === p.id
            : themeId === 'shop-sovereign';
  const effects: Piece[] = SPECIAL_EFFECTS.map(({ id, name, desc }) => ({ id, kind: 'effect', title: name, blurb: desc }));
  const allOn = PIECES.every(wearing);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  const toggle = (p: Piece, on: boolean) => {
    if (p.kind === 'name') return updateMyProfile({ name_style: { ...(me.name_style ?? {}), effect: on ? SPECIAL_NAME_EFFECT : 'none' } as Profile['name_style'] });
    return equip(on ? ITEMS.get(p.id)! : null, p.kind);
  };
  const equipAll = () => run(async () => { for (const p of PIECES) if (!wearing(p)) await toggle(p, true); }, 'The full Sovereign set is on.');
  const removeAll = () => run(async () => { for (const p of [...PIECES, ...effects]) if (wearing(p)) await toggle(p, false); }, 'Removed the Sovereign set.');

  const previewMe = { ...me, name_style: { ...(me.name_style ?? {}), effect: SPECIAL_NAME_EFFECT } } as Profile;
  return (
    <div className="special-tab">
      <div className="special-hero">
        <ProfileEffect id="effect.sovereign.owner" className="special-hero-fx" />
        <div className="special-hero-text">
          <span className="special-kicker">
            <Icon name="sparkles" size={13} /> Owners only
          </span>
          <h2>Sovereign</h2>
          <p>A set made only for Venband owners. Nobody else can collect it or put it on — not even with the Shop.</p>
          <div className="row-start">
            {allOn ? (
              <button className="btn secondary" disabled={busy} onClick={removeAll}>
                Take it all off
              </button>
            ) : (
              <button className="btn special-btn" disabled={busy} onClick={equipAll}>
                <Icon name="sparkles" size={15} /> Equip the full set
              </button>
            )}
          </div>
          {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
        </div>
        <div className="special-hero-preview">
          <ProfilePreview me={previewMe} item={ITEMS.get('effect.sovereign.owner')!} bundle={['deco.sovereign.owner', 'effect.sovereign.owner', 'plate.sovereign.owner']} />
        </div>
      </div>

      <div className="special-grid">
        {[...PIECES, ...effects].map((p) => {
          const on = wearing(p);
          return (
            <article key={p.id} className={`special-card${on ? ' on' : ''}`}>
              <div className="special-card-prev">{preview(p, me)}</div>
              <div className="special-card-body">
                <div className="special-card-title">
                  <b>{p.title}</b>
                  {on && (
                    <span className="special-on">
                      <Icon name="check" size={11} /> On
                    </span>
                  )}
                </div>
                <p className="small muted">{p.blurb}</p>
                <button className={`btn small ${on ? 'secondary' : 'special-btn'}`} disabled={busy} onClick={() => run(() => toggle(p, !on), on ? `${p.title} removed.` : `${p.title} is on.`)}>
                  {on ? 'Remove' : 'Equip'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function preview(p: Piece, me: Profile): ReactNode {
  if (p.kind === 'effect')
    return (
      <div className="special-fx-box">
        <Avatar profile={{ ...me, avatar_frame: 'none' } as Profile} size={52} />
        <ProfileEffect id={p.id} />
      </div>
    );
  if (p.kind === 'decoration') return <Avatar profile={{ ...me, avatar_frame: p.id } as Profile} size={86} />;
  if (p.kind === 'nameplate')
    return (
      <div className="member nameplate-row shop-plate-row special-plate">
        <NameplateArt id={p.id} />
        <Avatar profile={{ ...me, avatar_frame: 'none' } as Profile} size={30} />
        <span className="member-name">{me.display_name}</span>
      </div>
    );
  if (p.kind === 'name')
    return (
      <span className="special-name">
        <StyledName style={{ ...(me.name_style ?? {}), effect: SPECIAL_NAME_EFFECT }}>{me.display_name}</StyledName>
      </span>
    );
  const t = shopTheme(p.id);
  return t ? <ThemeSwatch t={t} /> : null;
}
