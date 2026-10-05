// Dialogs that can be opened from anywhere (menus, profiles…).
import { createStore } from '../lib/store';
import { InviteFriendsList, InviteToServersModal, ServerPreviewModal } from './Invite';
import { Icon, Modal } from './ui';
import { useState } from 'react';
import { checkLink, isTrusted, type LinkCheck } from '../lib/linkSafety';
import { getSettings, updateSettings } from '../lib/settings';

type Open =
  | { kind: 'invite-to-servers'; userId: string }
  | { kind: 'invite-to-voice'; serverId: string; serverName: string; channelId: string; channelName: string }
  | { kind: 'server-preview'; serverId: string }
  | { kind: 'link'; check: LinkCheck };

const store = createStore<{ open: Open | null }>({ open: null });

export function openGlobalModal(o: Open) {
  store.set({ open: o });
}

export function GlobalModals() {
  const open = store.use((s) => s.open);
  const close = () => store.set({ open: null });
  if (!open) return null;
  if (open.kind === 'invite-to-servers') return <InviteToServersModal userId={open.userId} onClose={close} />;
  if (open.kind === 'server-preview') return <ServerPreviewModal serverId={open.serverId} onClose={close} />;
  if (open.kind === 'link') return <LeavingVenband check={open.check} onClose={close} />;
  return (
    <Modal title={`Invite friends to ${open.channelName}`} onClose={close}>
      <p className="small muted">They get a link that joins {open.serverName} and drops them straight into the voice channel.</p>
      <InviteFriendsList serverId={open.serverId} serverName={open.serverName} voiceChannel={{ id: open.channelId, name: open.channelName }} />
    </Modal>
  );
}

/** Click handler for links in messages: opens right away or asks first. */
export function guardLink(e: { preventDefault: () => void }, href: string, shownText?: string) {
  const check = checkLink(href, shownText);
  const mode = getSettings().chat.linkWarnings;
  const trusted = isTrusted(check.host, getSettings().trustedDomains);
  if (check.level === 'safe' && (mode === 'off' || mode === 'risky' || trusted)) return;
  if (mode === 'off' && check.level !== 'danger') return;
  e.preventDefault();
  openGlobalModal({ kind: 'link', check });
}

function LeavingVenband({ check, onClose }: { check: LinkCheck; onClose: () => void }) {
  const [trust, setTrust] = useState(false);
  const danger = check.level === 'danger';
  return (
    <Modal title={danger ? 'This link looks dangerous' : 'Leaving Venband'} onClose={onClose}>
      <div className={`link-check ${check.level}`}>
        <Icon name={danger ? 'warning' : 'external'} size={22} />
        <div className="grow">
          <div className="small muted">This link goes to</div>
          <div className="link-host">{check.host}</div>
          <div className="link-full small muted">{check.url}</div>
        </div>
      </div>
      {check.risks.length > 0 && (
        <ul className="link-risks">
          {check.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {danger && <p className="small">Scam links often steal accounts. Don’t log in or download anything there unless you’re sure.</p>}
      {!danger && (
        <label className="check-row small">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Trust {check.host} links from now on
        </label>
      )}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose} autoFocus>
          Go back
        </button>
        <button
          className={`btn ${danger ? 'danger' : 'primary'}`}
          onClick={() => {
            if (trust) updateSettings((s) => ({ trustedDomains: [...new Set([...s.trustedDomains, check.host.replace(/^www\./, '')])] }));
            window.open(check.url, '_blank', 'noopener,noreferrer');
            onClose();
          }}
        >
          {danger ? 'Open anyway' : 'Visit site'}
        </button>
      </div>
    </Modal>
  );
}
