// The menu behind your avatar in the top-right corner: status, profile,
// settings, switching between accounts on this device, and logging out.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sessionStore, signOut, updateMyProfile } from '../lib/session';
import { addAccount, otherAccounts, switchAccount, type SavedAccount } from '../lib/accounts';
import { openSettings } from '../lib/ui';
import { errorMessage } from '../lib/supabase';
import { useSettings } from '../lib/settings';
import type { PresenceStatus } from '../lib/types';
import { Avatar, Icon } from './ui';
import { askConfirm, askText } from './Dialogs';
import { copyText } from './ContextMenu';
import { bannerStyle, openProfile } from './People';

const PRESENCE_LABEL: Record<PresenceStatus, string> = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };

const STATUSES: { id: PresenceStatus; hint: string }[] = [
  { id: 'online', hint: '' },
  { id: 'idle', hint: 'Shows you as away' },
  { id: 'dnd', hint: 'No notification sounds or pop-ups' },
  { id: 'invisible', hint: 'You’ll look offline but can still chat' },
];

export function AccountMenu({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const me = sessionStore.use((s) => s.me)!;
  const dev = useSettings((s) => s.advanced.developerMode);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [others] = useState<SavedAccount[]>(() => otherAccounts(me.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // sit under the avatar, kept inside the window
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 320;
    const h = ref.current?.offsetHeight ?? 400;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && !(e.target as Element).closest?.('.modal-backdrop')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const presence = me.presence ?? 'online';
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div ref={ref} className="account-menu" role="menu" aria-label="Your account" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}>
      <div className="am-banner" style={bannerStyle(me)} />
      <div className="am-head">
        <Avatar profile={me} size={56} online />
        <div className="am-names">
          <b className="ellipsis">{me.display_name}</b>
          <span className="muted small ellipsis">@{me.username}</span>
          {me.status_text && <span className="am-status-text small ellipsis">{me.status_text}</span>}
        </div>
        <span className="streamer-pill">STREAMER</span>
      </div>

      <div className="am-section am-statuses" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            role="menuitemradio"
            aria-checked={presence === s.id}
            className={`am-status${presence === s.id ? ' active' : ''}`}
            title={s.hint}
            onClick={() => updateMyProfile({ presence: s.id }).catch((e) => setError(errorMessage(e)))}
          >
            <span className={`presence-dot ${s.id}`} />
            {PRESENCE_LABEL[s.id]}
          </button>
        ))}
      </div>

      <div className="am-section">
        <button
          role="menuitem"
          className="am-item"
          onClick={run(async () => {
            const v = await askText({ title: 'Custom status', label: 'What’s up?', initial: me.status_text ?? '', maxLength: 128 });
            if (v !== null) updateMyProfile({ status_text: v.trim() }).catch((e) => alert(errorMessage(e)));
          })}
        >
          <Icon name="smile" size={17} /> {me.status_text ? 'Edit custom status' : 'Set a custom status'}
        </button>
        {me.status_text && (
          <button role="menuitem" className="am-item" onClick={() => updateMyProfile({ status_text: '' }).catch((e) => setError(errorMessage(e)))}>
            <Icon name="x" size={17} /> Clear custom status
          </button>
        )}
      </div>

      <div className="am-section">
        <button role="menuitem" className="am-item" onClick={run(() => openProfile(me.id))}>
          <Icon name="user" size={17} /> View my profile
        </button>
        <button role="menuitem" className="am-item" onClick={run(() => openSettings('profile'))}>
          <Icon name="edit" size={17} /> Edit profile
        </button>
        <button role="menuitem" className="am-item" onClick={run(() => openSettings('account'))}>
          <Icon name="settings" size={17} /> Settings <kbd>Ctrl I</kbd>
        </button>
        <button role="menuitem" className="am-item" onClick={run(() => openSettings('keybinds'))}>
          <Icon name="keyboard" size={17} /> Keyboard shortcuts <kbd>Ctrl /</kbd>
        </button>
        {dev && (
          <button role="menuitem" className="am-item" onClick={run(() => copyText(me.id))}>
            <Icon name="copy" size={17} /> Copy user ID
          </button>
        )}
      </div>

      <div className="am-section">
        <div className="am-label">Switch accounts</div>
        {others.map((a) => (
          <button
            key={a.id}
            role="menuitem"
            className="am-item am-account"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(a.id);
              setError(null);
              try {
                await switchAccount(a.id, me);
              } catch (e) {
                setError(errorMessage(e));
                setBusy(null);
              }
            }}
          >
            <Avatar profile={{ id: a.id, username: a.username, display_name: a.display_name, avatar_color: a.avatar_color, avatar_url: a.avatar_url } as never} size={26} />
            <span className="grow ellipsis">
              {a.display_name} <span className="muted small">@{a.username}</span>
            </span>
            {busy === a.id ? <span className="spinner small" /> : <Icon name="switch" size={15} />}
          </button>
        ))}
        <button
          role="menuitem"
          className="am-item"
          disabled={busy !== null}
          onClick={async () => {
            setError(null);
            try {
              await addAccount(me);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <Icon name="plus" size={17} /> Add an account
        </button>
      </div>

      {error && <div className="form-error am-error">{error}</div>}

      <div className="am-section">
        <button
          role="menuitem"
          className="am-item danger"
          onClick={run(async () => {
            if (!(await askConfirm({ title: 'Log out?', body: `You’ll be logged out of @${me.username} on this device.`, confirm: 'Log out', danger: true }))) return;
            signOut();
          })}
        >
          <Icon name="logout" size={17} /> Log out
        </button>
      </div>
    </div>
  );
}
