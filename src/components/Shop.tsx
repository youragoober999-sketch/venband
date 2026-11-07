// The Venband Shop (the "Marketplace" in your home sidebar): hundreds of free
// avatar decorations, profile effects, nameplates, themes and bundles, plus
// the community marketplace. "Get" adds an item to your collection; "Equip"
// puts it on. Classics come from public-domain films, books, art and myths.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { sessionStore } from '../lib/session';
import { useSettings } from '../lib/settings';
import { errorMessage } from '../lib/supabase';
import { BUNDLES, COLLECTIONS, ITEMS, PRODUCTS, RARITY, SPECIAL_ITEMS, variantsOf, type Product, type ShopItem, type ShopKind } from '../lib/shop';
import { equip, getItems, inventoryStore, loadInventory, owns, shopTheme } from '../lib/inventory';
import type { Profile } from '../lib/types';
import { ProfileEffect, NameplateArt } from './Cosmetics';
import { MarketplaceView } from './Marketplace';
import { ThemeSwatch } from './ThemeStudio';
import { Avatar, Icon, Modal, StyledName } from './ui';
import './shop.css';

type Tab = 'featured' | ShopKind | 'classics' | 'community';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'featured', label: 'Featured', icon: 'sparkles' },
  { id: 'decoration', label: 'Avatar Decorations', icon: 'user' },
  { id: 'effect', label: 'Profile Effects', icon: 'sparkles' },
  { id: 'nameplate', label: 'Nameplates', icon: 'list' },
  { id: 'theme', label: 'Themes', icon: 'palette' },
  { id: 'bundle', label: 'Bundles', icon: 'gift' },
  { id: 'classics', label: 'Classics', icon: 'film' },
  { id: 'community', label: 'Community', icon: 'users' },
];
const CLASSIC = new Set<string>(COLLECTIONS.filter((c) => 'classic' in c && c.classic).map((c) => c.id));
const equippedId = (me: Profile, kind: ShopKind, themeId: string) =>
  kind === 'decoration' ? me.avatar_frame : kind === 'effect' ? me.profile_effect : kind === 'nameplate' ? me.nameplate : kind === 'theme' ? `theme.${themeId.replace(/^shop-/, '')}` : null;

export function ShopView() {
  const me = sessionStore.use((s) => s.me)!;
  const owned = inventoryStore.use((s) => s.owned);
  const [tab, setTab] = useState<Tab>('featured');
  const [q, setQ] = useState('');
  const [coll, setColl] = useState<string>('all');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<Product | null>(null);
  useEffect(() => {
    loadInventory().catch(() => {});
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PRODUCTS.filter((p) => {
      if (tab === 'classics' ? !CLASSIC.has(p.collection) : tab !== 'featured' && tab !== 'community' && p.kind !== tab) return false;
      if (coll !== 'all' && p.collection !== coll) return false;
      if (mine && !variantsOf(p).some((v) => owns(v.id))) return false;
      if (needle && !`${p.name} ${p.desc} ${p.credit ?? ''} ${p.collection}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, coll, mine, owned]);
  const itemCount = ITEMS.size - SPECIAL_ITEMS.length; // the owner-only set isn't sold

  return (
    <div className="shop-view">
      <header className="chat-header">
        <Icon name="sparkles" />
        <h3>Marketplace</h3>
        <span className="topic small muted">{itemCount} free items · decorations, effects, nameplates, themes and bundles</span>
      </header>
      <div className="shop-body">
        <nav className="shop-tabs" aria-label="Shop sections">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => (setTab(t.id), setColl('all'))}>
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ))}
        </nav>
        {tab === 'community' ? (
          <MarketplaceView embedded />
        ) : (
          <>
            {tab === 'featured' && !q && <Hero onOpen={setOpen} />}
            <div className="shop-toolbar">
              <input className="search-input" placeholder="Search the shop" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the shop" />
              <div className="shop-chips">
                <button className={`chip${coll === 'all' ? ' on' : ''}`} onClick={() => setColl('all')}>
                  All
                </button>
                {COLLECTIONS.filter((c) => tab !== 'classics' || CLASSIC.has(c.id)).map((c) => (
                  <button key={c.id} className={`chip${coll === c.id ? ' on' : ''}`} onClick={() => setColl(c.id)}>
                    {c.name}
                  </button>
                ))}
                <button className={`chip${mine ? ' on' : ''}`} onClick={() => setMine((v) => !v)}>
                  <Icon name="check" size={13} /> In my collection
                </button>
              </div>
            </div>
            {tab === 'classics' && (
              <p className="shop-note">
                <Icon name="film" size={14} /> Classics are inspired by films, books, paintings and myths that are in the public domain — old enough to belong to everyone. Each item says where it comes from.
              </p>
            )}
            {tab === 'featured' && coll === 'all' && !q && !mine ? (
              COLLECTIONS.filter((c) => c.id !== 'originals').map((c) => {
                const ps = list.filter((p) => p.collection === c.id);
                if (!ps.length) return null;
                return (
                  <section key={c.id} className="shop-section">
                    <div className="shop-section-head">
                      <div>
                        <h4>{c.name}</h4>
                        <p className="small muted">{c.blurb}</p>
                      </div>
                      <button className="btn link small" onClick={() => setColl(c.id)}>
                        See all {ps.length}
                      </button>
                    </div>
                    <div className="shop-grid">
                      {ps.slice(0, 8).map((p) => (
                        <ProductCard key={p.key} p={p} me={me} onOpen={setOpen} />
                      ))}
                    </div>
                  </section>
                );
              })
            ) : (
              <>
                {!list.length && <p className="muted shop-empty">Nothing matches — try another search or collection.</p>}
                <div className="shop-grid">
                  {list.map((p) => (
                    <ProductCard key={p.key} p={p} me={me} onOpen={setOpen} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      {open && <ProductModal p={open} me={me} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ----------------------------------------------------------------- hero --
const HERO = ['deco.moon_voyage', 'deco.starry_ring', 'deco.count_castle', 'deco.cheshire', 'deco.eclipse', 'deco.grand_wings'];
function Hero({ onOpen }: { onOpen: (p: Product) => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % HERO.length), 6000);
    return () => clearInterval(t);
  }, []);
  const p = PRODUCTS.find((x) => x.key === HERO[i])!;
  const v = variantsOf(p)[0];
  const bundle = BUNDLES.find((b) => b.items.includes(v.id));
  const coll = COLLECTIONS.find((c) => c.id === p.collection)!;
  return (
    <div className="shop-hero" style={{ '--h1': v.palette.c[1], '--h2': v.palette.c[3] } as CSSProperties}>
      <ProfileEffect id={bundle?.items.find((x) => x.startsWith('effect.')) ?? 'effect.stardust.gold'} className="shop-hero-fx" />
      <div className="shop-hero-text">
        <span className="shop-kicker">{coll.name}</span>
        <h2>{p.name}</h2>
        <p>{p.desc}</p>
        {p.credit && <p className="shop-credit">From {p.credit}</p>}
        <div className="row-start">
          <button className="btn primary" onClick={() => onOpen(p)}>
            Take a look
          </button>
          {bundle && (
            <button className="btn secondary" onClick={() => onOpen(PRODUCTS.find((x) => x.key === bundle.id)!)}>
              {bundle.name} bundle
            </button>
          )}
        </div>
      </div>
      <div className="shop-hero-art">
        <Avatar profile={{ ...me, avatar_frame: v.id } as Profile} size={150} />
      </div>
      <div className="shop-hero-dots">
        {HERO.map((_, k) => (
          <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Show featured item ${k + 1}`} />
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- cards --
function Preview({ item, me, big }: { item: ShopItem; me: Profile; big?: boolean }) {
  if (item.kind === 'decoration') return <div className="shop-prev deco"><Avatar profile={{ ...me, avatar_frame: item.id } as Profile} size={big ? 132 : 84} /></div>;
  if (item.kind === 'effect')
    return (
      <div className="shop-prev effect" style={{ '--pb': me.banner_color ?? me.avatar_color } as CSSProperties}>
        <div className="shop-mini-profile">
          <b className="banner" />
          <Avatar profile={{ ...me, avatar_frame: 'none' } as Profile} size={big ? 64 : 44} />
          <span className="nm">{me.display_name}</span>
          <i />
          <i className="short" />
        </div>
        <ProfileEffect id={item.id} />
      </div>
    );
  if (item.kind === 'nameplate')
    return (
      <div className="shop-prev plate">
        <div className="shop-fake-row"><span className="dot" /><i /></div>
        <div className="member nameplate-row shop-plate-row">
          <NameplateArt id={item.id} />
          <Avatar profile={{ ...me, avatar_frame: 'none' } as Profile} size={big ? 34 : 28} />
          <span className="member-name"><StyledName style={me.name_style}>{me.display_name}</StyledName></span>
        </div>
        <div className="shop-fake-row"><span className="dot" /><i className="short" /></div>
      </div>
    );
  if (item.kind === 'theme') {
    const t = shopTheme(item.id);
    return <div className="shop-prev theme">{t && <ThemeSwatch t={t} />}</div>;
  }
  // bundle: a little collage of what's inside
  const b = BUNDLES.find((x) => x.id === item.id)!;
  const pick = (pre: string) => b.items.find((x) => x.startsWith(pre));
  const deco = pick('deco.'), fx = pick('effect.'), plate = pick('plate.');
  return (
    <div className="shop-prev bundle">
      {fx && <ProfileEffect id={fx} />}
      {deco && <Avatar profile={{ ...me, avatar_frame: deco } as Profile} size={big ? 96 : 64} />}
      {plate && (
        <div className="member nameplate-row shop-plate-row small">
          <NameplateArt id={plate} />
          <span className="member-name">{me.display_name}</span>
        </div>
      )}
      <span className="shop-bundle-count">{b.items.length} items</span>
    </div>
  );
}

function ProductCard({ p, me, onOpen }: { p: Product; me: Profile; onOpen: (p: Product) => void }) {
  const vs = variantsOf(p);
  const [vi, setVi] = useState(0);
  const v = vs[Math.min(vi, vs.length - 1)];
  const have = vs.filter((x) => owns(x.id)).length;
  const r = RARITY[p.rarity];
  return (
    <article className={`shop-card kind-${p.kind}`} onClick={() => onOpen(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p)} aria-label={p.name}>
      <Preview item={v} me={me} />
      <div className="shop-card-meta">
        <div className="shop-card-title">
          <b>{p.name}</b>
          {p.isNew && <span className="shop-new">NEW</span>}
        </div>
        <div className="shop-card-row">
          <span className="shop-price">{have === vs.length ? <><Icon name="check" size={12} /> Collected</> : 'Free'}</span>
          <span className="shop-rarity" style={{ color: r.color }}>{r.label}</span>
          {vs.length > 1 && (
            <span className="shop-swatches" onClick={(e) => e.stopPropagation()}>
              {vs.slice(0, 5).map((x, i) => (
                <button key={x.id} className={i === vi ? 'on' : ''} style={{ background: `linear-gradient(135deg, ${x.palette.c[0]}, ${x.palette.c[1]})` }} onMouseEnter={() => setVi(i)} onClick={() => setVi(i)} aria-label={x.palette.name} title={x.palette.name} />
              ))}
              {vs.length > 5 && <span className="more">+{vs.length - 5}</span>}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

// ----------------------------------------------------------------- detail --
function ProductModal({ p, me, onClose }: { p: Product; me: Profile; onClose: () => void }) {
  const vs = variantsOf(p);
  const themeId = useSettings((s) => s.themeId);
  useEffect(() => {
    loadInventory().catch(() => {});
  }, []);
  inventoryStore.use((s) => s.owned);
  const [vi, setVi] = useState(0);
  const v = vs[vi];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const coll = COLLECTIONS.find((c) => c.id === p.collection)!;
  const bundle = p.kind === 'bundle' ? BUNDLES.find((b) => b.id === p.key)! : null;
  const on = bundle ? bundle.items.every((id) => equippedId(me, ITEMS.get(id)!.kind, themeId) === id) : equippedId(me, p.kind, themeId) === v.id;
  const has = owns(v.id) && (!bundle || bundle.items.every(owns));

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
  const getIt = () => run(() => getItems([v.id]), bundle ? `Added ${bundle.items.length} items to your collection.` : `${p.name} is in your collection.`);
  const equipIt = () =>
    run(async () => {
      if (!owns(v.id)) await getItems([v.id]);
      if (bundle) {
        for (const id of bundle.items) await equip(ITEMS.get(id)!, ITEMS.get(id)!.kind);
      } else await equip(v, p.kind);
    }, bundle ? 'Bundle equipped — your whole profile changed.' : `${p.name} equipped.`);
  const unequip = () => run(() => equip(null, p.kind), 'Removed.');

  return (
    <Modal title={p.name} onClose={onClose} wide className="shop-modal">
      <div className="shop-detail">
        <div className="shop-detail-preview">
          <ProfilePreview me={me} item={v} bundle={bundle?.items} />
        </div>
        <div className="shop-detail-info">
          <div className="row-start">
            <span className="shop-rarity big" style={{ color: RARITY[p.rarity].color, borderColor: RARITY[p.rarity].color }}>{RARITY[p.rarity].label}</span>
            <span className="small muted">{coll.name}</span>
          </div>
          <p>{p.desc}</p>
          {p.credit && (
            <p className="shop-credit">
              <Icon name="film" size={13} /> From {p.credit} — public domain, reimagined by Venband.
            </p>
          )}
          {vs.length > 1 && (
            <>
              <div className="small muted">Colour — {v.palette.name}</div>
              <div className="shop-swatches big">
                {vs.map((x, i) => (
                  <button key={x.id} className={i === vi ? 'on' : ''} style={{ background: `linear-gradient(135deg, ${x.palette.c[0]}, ${x.palette.c[1]})` }} onClick={() => setVi(i)} aria-label={x.palette.name} title={`${x.palette.name}${owns(x.id) ? ' (collected)' : ''}`}>
                    {owns(x.id) && <Icon name="check" size={11} />}
                  </button>
                ))}
              </div>
            </>
          )}
          {bundle && (
            <ul className="shop-bundle-list">
              {bundle.items.map((id) => {
                const it = ITEMS.get(id)!;
                return (
                  <li key={id}>
                    <Icon name={owns(id) ? 'check' : 'plus'} size={13} /> {it.name} <span className="muted small">· {it.kind === 'decoration' ? 'Avatar decoration' : it.kind === 'effect' ? 'Profile effect' : it.kind === 'nameplate' ? 'Nameplate' : 'Theme'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="shop-actions">
            {!has && (
              <button className="btn secondary" disabled={busy} onClick={getIt}>
                Get — Free
              </button>
            )}
            {on && bundle ? (
              <button className="btn secondary" disabled>
                <Icon name="check" size={14} /> Equipped
              </button>
            ) : on ? (
              <button className="btn secondary" disabled={busy} onClick={unequip}>
                Unequip
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={equipIt}>
                {has ? 'Equip' : 'Get & equip'}
              </button>
            )}
          </div>
          {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
          <p className="small muted">{p.kind === 'theme' ? 'Themes change how Venband looks for you on this device.' : 'Everyone sees what you equip on your profile, in chats and in member lists.'}</p>
        </div>
      </div>
    </Modal>
  );
}

/** A profile card with the item (or the whole bundle) applied. */
export function ProfilePreview({ me, item, bundle }: { me: Profile; item: ShopItem; bundle?: string[] }) {
  const ids = bundle ?? [item.id];
  const pick = (kind: ShopKind, fallback: string | null | undefined) => ids.find((id) => ITEMS.get(id)?.kind === kind) ?? fallback;
  const deco = pick('decoration', me.avatar_frame);
  const fx = pick('effect', me.profile_effect);
  const plate = pick('nameplate', me.nameplate);
  const theme = pick('theme', null);
  const t = theme ? shopTheme(theme) : null;
  const style = t ? (Object.fromEntries(Object.entries(t.vars).map(([k, v]) => [`--${k}`, v])) as CSSProperties) : undefined;
  return (
    <div className="shop-profile" style={style}>
      <div className="shop-profile-card">
        <b className="banner" style={{ background: me.banner_color2 ? `linear-gradient(135deg, ${me.banner_color ?? me.avatar_color}, ${me.banner_color2})` : (me.banner_color ?? me.avatar_color) }} />
        <div className="shop-profile-avatar">
          <Avatar profile={{ ...me, avatar_frame: deco ?? 'none' } as Profile} size={92} />
        </div>
        <div className="shop-profile-body">
          <div className="nm">
            <StyledName style={me.name_style}>{me.display_name}</StyledName>
          </div>
          <div className="small muted">@{me.username}</div>
          <div className="member nameplate-row shop-plate-row">
            <NameplateArt id={plate} />
            <Avatar profile={{ ...me, avatar_frame: deco ?? 'none' } as Profile} size={30} />
            <span className="member-name">{me.display_name}</span>
          </div>
          <div className="shop-profile-lines">
            <i />
            <i className="short" />
          </div>
        </div>
        <ProfileEffect id={fx} />
      </div>
      {item.kind === 'theme' && t && <ThemeSwatch t={t} />}
    </div>
  );
}
