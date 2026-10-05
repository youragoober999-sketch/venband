// Keep in sync with the permission bits documented in the SQL migration.
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
} as const;

export const ALL_PERMISSIONS = 4095;

export const PERMISSION_INFO: { bit: number; name: string; description: string }[] = [
  { bit: P.ADMINISTRATOR, name: 'Administrator', description: 'Every permission and access to every channel. Dangerous.' },
  { bit: P.MANAGE_SERVER, name: 'Manage Server', description: 'Rename the server, change its icon, manage invites.' },
  { bit: P.MANAGE_ROLES, name: 'Manage Roles', description: 'Create and edit roles below their highest role.' },
  { bit: P.MANAGE_CHANNELS, name: 'Manage Channels', description: 'Create, edit and delete channels. Sees private channels.' },
  { bit: P.KICK_MEMBERS, name: 'Kick Members', description: 'Remove members with lower roles.' },
  { bit: P.BAN_MEMBERS, name: 'Ban Members', description: 'Permanently remove members with lower roles.' },
  { bit: P.CREATE_INVITE, name: 'Create Invite', description: 'Invite new people to the server.' },
  { bit: P.SEND_MESSAGES, name: 'Send Messages', description: 'Send messages in text channels.' },
  { bit: P.MANAGE_MESSAGES, name: 'Manage Messages', description: "Delete other members' messages." },
  { bit: P.CONNECT, name: 'Connect', description: 'Join voice channels.' },
  { bit: P.SPEAK, name: 'Speak', description: 'Talk in voice channels.' },
  { bit: P.VIDEO, name: 'Video & Screen Share', description: 'Turn on camera and share screen in voice channels.' },
];

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
