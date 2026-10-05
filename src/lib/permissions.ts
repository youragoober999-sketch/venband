// Keep in sync with the permission bits documented in the SQL migrations
// (20260928000000_venband_schema.sql and 20261004000000_messaging.sql).
// The server checks every one of these itself; the app only uses them to
// decide what to show.
export const P = {
  ADMINISTRATOR: 1,
  MANAGE_SERVER: 2,
  MANAGE_ROLES: 4,
  MANAGE_CHANNELS: 8,
  KICK_MEMBERS: 16,
  BAN_MEMBERS: 32,
  CREATE_INVITE: 64,
  SEND_MESSAGES: 128,
  MANAGE_MESSAGES: 256,
  CONNECT: 512,
  SPEAK: 1024,
  VIDEO: 2048,
  ADD_REACTIONS: 4096,
  CREATE_THREADS: 8192,
  MANAGE_THREADS: 16384,
  CREATE_POLLS: 32768,
  ATTACH_FILES: 65536,
  EMBED_LINKS: 131072,
  MENTION_EVERYONE: 262144,
  USE_SOUNDBOARD: 524288,
  MANAGE_EXPRESSIONS: 1048576,
  MODERATE_MEMBERS: 2097152,
  VIEW_AUDIT_LOG: 4194304,
  MANAGE_EVENTS: 8388608,
  MANAGE_INTEGRATIONS: 16777216,
  MUTE_MEMBERS: 33554432,
  DEAFEN_MEMBERS: 67108864,
  MOVE_MEMBERS: 134217728,
  MANAGE_NICKNAMES: 268435456,
  CHANGE_NICKNAME: 536870912,
  REQUEST_TO_SPEAK: 1073741824,
} as const;

export const ALL_PERMISSIONS = 2147483647;

/** What a brand-new @everyone role can do. */
export const DEFAULT_EVERYONE =
  P.SEND_MESSAGES | P.CREATE_INVITE | P.CONNECT | P.SPEAK | P.VIDEO | P.ADD_REACTIONS | P.CREATE_THREADS | P.CREATE_POLLS |
  P.ATTACH_FILES | P.EMBED_LINKS | P.USE_SOUNDBOARD | P.CHANGE_NICKNAME | P.REQUEST_TO_SPEAK;

export type PermissionGroup = 'General' | 'Text' | 'Voice' | 'Moderation' | 'Events & Apps' | 'Threads & Forums' | 'Customization';

export const PERMISSION_INFO: { bit: number; name: string; description: string; group: PermissionGroup; dangerous?: boolean }[] = [
  { bit: P.ADMINISTRATOR, group: 'General', dangerous: true, name: 'Administrator', description: 'Every permission and access to every channel. Only give this to people you fully trust.' },
  { bit: P.MANAGE_SERVER, group: 'General', dangerous: true, name: 'Manage Server', description: 'Rename the server, change its picture, banner and settings.' },
  { bit: P.MANAGE_ROLES, group: 'General', dangerous: true, name: 'Manage Roles', description: 'Create and edit roles below their own highest role.' },
  { bit: P.MANAGE_CHANNELS, group: 'General', name: 'Manage Channels', description: 'Create, edit, reorder and delete channels. Sees private channels.' },
  { bit: P.VIEW_AUDIT_LOG, group: 'General', name: 'View Audit Log', description: 'See the record of changes made in this server.' },
  { bit: P.CREATE_INVITE, group: 'General', name: 'Create Invite', description: 'Invite new people to the server.' },
  { bit: P.CHANGE_NICKNAME, group: 'General', name: 'Change Nickname', description: 'Change their own nickname in this server.' },
  { bit: P.MANAGE_NICKNAMES, group: 'General', name: 'Manage Nicknames', description: 'Change other members’ nicknames.' },

  { bit: P.SEND_MESSAGES, group: 'Text', name: 'Send Messages', description: 'Send messages in text channels.' },
  { bit: P.ATTACH_FILES, group: 'Text', name: 'Attach Files', description: 'Upload pictures, videos and files.' },
  { bit: P.EMBED_LINKS, group: 'Text', name: 'Embed Links', description: 'Links they post show previews.' },
  { bit: P.ADD_REACTIONS, group: 'Text', name: 'Add Reactions', description: 'React to messages with emoji.' },
  { bit: P.CREATE_POLLS, group: 'Text', name: 'Create Polls', description: 'Post polls.' },
  { bit: P.MENTION_EVERYONE, group: 'Text', name: 'Mention @everyone and @here', description: 'Notify everyone in a channel at once.' },
  { bit: P.MANAGE_MESSAGES, group: 'Text', name: 'Manage Messages', description: 'Delete and pin other members’ messages; see deleted messages in the log.' },

  { bit: P.CREATE_THREADS, group: 'Threads & Forums', name: 'Create Threads & Posts', description: 'Start threads and forum posts.' },
  { bit: P.MANAGE_THREADS, group: 'Threads & Forums', name: 'Manage Threads', description: 'Rename, lock, archive and delete any thread or forum post.' },

  { bit: P.CONNECT, group: 'Voice', name: 'Connect', description: 'Join voice and stage channels.' },
  { bit: P.SPEAK, group: 'Voice', name: 'Speak', description: 'Talk in voice channels and as a stage speaker.' },
  { bit: P.VIDEO, group: 'Voice', name: 'Video & Screen Share', description: 'Turn on their camera and share their screen.' },
  { bit: P.USE_SOUNDBOARD, group: 'Voice', name: 'Use Soundboard', description: 'Play soundboard sounds in calls.' },
  { bit: P.REQUEST_TO_SPEAK, group: 'Voice', name: 'Request to Speak', description: 'Raise their hand on a stage.' },
  { bit: P.MUTE_MEMBERS, group: 'Voice', name: 'Mute Members', description: 'Server-mute other people in voice.' },
  { bit: P.DEAFEN_MEMBERS, group: 'Voice', name: 'Deafen Members', description: 'Server-deafen other people in voice.' },
  { bit: P.MOVE_MEMBERS, group: 'Voice', name: 'Move & Disconnect Members', description: 'Move people between voice channels or disconnect them.' },

  { bit: P.KICK_MEMBERS, group: 'Moderation', name: 'Kick Members', description: 'Remove members with lower roles.' },
  { bit: P.BAN_MEMBERS, group: 'Moderation', dangerous: true, name: 'Ban Members', description: 'Ban members with lower roles.' },
  { bit: P.MODERATE_MEMBERS, group: 'Moderation', name: 'Timeout & Warn Members', description: 'Time out or warn members with lower roles.' },

  { bit: P.MANAGE_EVENTS, group: 'Events & Apps', name: 'Manage Events', description: 'Create and edit server events.' },
  { bit: P.MANAGE_INTEGRATIONS, group: 'Events & Apps', name: 'Manage Integrations', description: 'Add, configure and remove bots, apps and webhooks.' },

  { bit: P.MANAGE_EXPRESSIONS, group: 'Customization', name: 'Manage Emoji, Stickers & Sounds', description: 'Upload and remove server emoji, GIFs, stickers and soundboard sounds.' },
];

export const PERMISSION_GROUPS: PermissionGroup[] = ['General', 'Text', 'Threads & Forums', 'Voice', 'Moderation', 'Events & Apps', 'Customization'];

export function computePermissions(
  userId: string,
  ownerId: string,
  roles: { id: string; permissions: number; is_default: boolean }[],
  memberRoleIds: Set<string>,
): number {
  if (userId === ownerId) return ALL_PERMISSIONS;
  let perms = 0;
  for (const r of roles) if (r.is_default || memberRoleIds.has(r.id)) perms |= r.permissions;
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms;
}

export function has(perms: number, bit: number): boolean {
  return (perms & bit) === bit;
}

/** Plain-English reason an action isn't allowed. */
export function deniedReason(bit: number): string {
  const p = PERMISSION_INFO.find((x) => x.bit === bit);
  return p ? `You can’t do this here because none of your roles has the “${p.name}” permission.` : 'You don’t have permission to do this here.';
}
