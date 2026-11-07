// Switch between the accounts saved on this device (lib/accounts.ts).
import { useEffect, useState } from 'react';
import { addAccount, forgetAllAccounts, listAccounts, MAX_ACCOUNTS, onAccountsChanged, removeAccount, switchTo, type SavedAccount } from '../lib/accounts';
import { signOut } from '../lib/session';
import type { Profile } from '../lib/types';
import { askConfirm } from './Dialogs';
import { openMenuAt } from './ContextMenu';
import { Avatar, Icon, Modal, StyledName } from './ui';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

export function AccountSwitcher({ me, onClose }: { me: Profile; onClose: () => void }) {
  const [accounts, setAccounts] = useState<SavedAccount[]>(listAccounts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onAccountsChanged(() => setAccounts(listAccounts())), []);
  const others = accounts.filter((a) => a.userId !== me.id);
  const full = accounts.length >= MAX_ACCOUNTS;

  async function go(a: SavedAccount) {
    setBusy(a.userId);
    setError(null);
    try {
      await switchTo(a);
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(null);
    }
  }

  return (
    <Modal title="Accounts" onClose={onClose} className="acct-modal">
      <p className="acct-lead">Switch in one click — no logging out. Up to {MAX_ACCOUNTS} accounts on this device.</p>

      <div className="acct-current">
        <Avatar profile={me} size={64} online />
        <div className="acct-info">
          <div className="acct-name">
            <StyledName style={me.name_style}>{me.display_name}</StyledName>
          </div>
          <div className="acct-user">@{me.username}</div>
        </div>
        <span className="acct-active">
          <i /> Active
        </span>
      </div>

      {others.length > 0 && <div className="acct-label">Switch to</div>}
      <div className="acct-list">
        {others.map((a) => {
          const profile = { display_name: a.displayName, avatar_color: a.avatarColor, avatar_url: a.avatarUrl, avatar_frame: a.avatarFrame ?? 'none' } as Profile;
          return (
            <div key={a.userId} className={`acct-row${busy === a.userId ? ' busy' : ''}`}>
              <button className="acct-main" onClick={() => go(a)} disabled={Boolean(busy)} aria-label={`Switch to ${a.displayName}`}>
                <Avatar profile={profile} size={48} />
                <span className="acct-info">
                  <span className="acct-name">{a.displayName}</span>
                  <span className="acct-user">
                    @{a.username}
                    {a.needsSignIn ? <span className="acct-pill warn">Sign in again</span> : <span className="acct-seen">· {ago(a.lastUsed)}</span>}
                  </span>
                </span>
                <span className="acct-go">{busy === a.userId ? <span className="spinner small" /> : <Icon name="chevron" size={16} />}</span>
              </button>
              <button
                className="icon-btn acct-more"
                aria-label={`Options for ${a.displayName}`}
                onClick={(e) =>
                  openMenuAt(e.currentTarget, [
                    { label: 'Remove from this device', icon: 'trash', danger: true, onClick: () => removeAccount(a.userId) },
                  ])
                }
              >
                <Icon name="more" size={16} />
              </button>
            </div>
          );
        })}
        {!full && (
          <button className="acct-add" onClick={() => addAccount()}>
            <span className="acct-add-icon">
              <Icon name="plus" size={20} />
            </span>
            <span className="acct-info">
              <span className="acct-name">Add an account</span>
              <span className="acct-user">Sign in or create one — you stay signed in here.</span>
            </span>
          </button>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="acct-footer">
        <button
          className="btn link small danger-text"
          onClick={async () => {
            if (!(await askConfirm({ title: 'Log out of every account?', body: 'All accounts on this device are signed out and forgotten here.', confirm: 'Log out all', danger: true }))) return;
            forgetAllAccounts();
            await signOut();
          }}
        >
          Log out of every account
        </button>
      </div>
    </Modal>
  );
}
