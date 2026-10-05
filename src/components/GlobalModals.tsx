// Dialogs that can be opened from anywhere (menus, profiles…).
import { createStore } from '../lib/store';
import { InviteFriendsList, InviteToServersModal, ServerPreviewModal } from './Invite';
import { Modal } from './ui';

type Open =
  | { kind: 'invite-to-servers'; userId: string }
  | { kind: 'invite-to-voice'; serverId: string; serverName: string; channelId: string; channelName: string }
  | { kind: 'server-preview'; serverId: string };

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
  return (
    <Modal title={`Invite friends to ${open.channelName}`} onClose={close}>
      <p className="small muted">They get a link that joins {open.serverName} and drops them straight into the voice channel.</p>
      <InviteFriendsList serverId={open.serverId} serverName={open.serverName} voiceChannel={{ id: open.channelId, name: open.channelName }} />
    </Modal>
  );
}
