// Client-side mirror of the SQL overwrite logic (migrations .../20261009000000_
// channel_overwrites.sql). The server re-checks everything; this only decides
// what UI to show.
import type { ChannelOverwrite } from './types';
import { ALL_PERMISSIONS, P } from './permissions';

/** Permissions that can sensibly be overridden per channel/category. */
export const OVERWRITE_MASK = ALL_PERMISSIONS & ~(P.ADMINISTRATOR | P.MANAGE_SERVER);

function applyOverwrites(
  base: number,
  overwrites: ChannelOverwrite[],
  myRoleIds: Set<string>,
  rolePosition: (roleId: string) => number,
  myUserId: string,
): number {
  let perms = base;
  const sorted = [...overwrites].sort(
    (a, b) =>
      (a.target_type === 'member' ? Number.MAX_SAFE_INTEGER : rolePosition(a.target_id)) -
        (b.target_type === 'member' ? Number.MAX_SAFE_INTEGER : rolePosition(b.target_id)) ||
      (a.target_id < b.target_id ? -1 : 1),
  );
  for (const o of sorted) {
    if (o.target_type === 'member') {
      if (o.target_id !== myUserId) continue;
    } else if (!myRoleIds.has(o.target_id)) continue;
    perms = (perms & ~o.deny) | o.allow;
  }
  return perms;
}

/**
 * Effective integer permissions for `me` in a channel, given server-wide base
 * permissions plus that channel's (and its category's) overwrites.
 */
export function channelPermissions(opts: {
  me: string;
  ownerId: string;
  base: number;
  myRoleIds: Set<string>;
  rolePosition: (roleId: string) => number;
  categoryOverwrites: ChannelOverwrite[];
  channelOverwrites: ChannelOverwrite[];
}): number {
  if (opts.me === opts.ownerId) return ALL_PERMISSIONS;
  if ((opts.base & P.ADMINISTRATOR) === P.ADMINISTRATOR) return ALL_PERMISSIONS;
  // category first, then the channel's own overwrites layer on top
  let perms = opts.base;
  perms = applyOverwrites(perms, opts.categoryOverwrites, opts.myRoleIds, opts.rolePosition, opts.me);
  perms = applyOverwrites(perms, opts.channelOverwrites, opts.myRoleIds, opts.rolePosition, opts.me);
  return perms & OVERWRITE_MASK;
}

/** True when a specific permission bit is set in an (already computed) channel permission set. */
export function can(perms: number, bit: number): boolean {
  return (perms & bit) === bit;
}