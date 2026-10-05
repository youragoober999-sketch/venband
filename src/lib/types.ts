export type PlatformRole = 'user' | 'moderator' | 'admin' | 'owner';
export type AccountStatus = 'active' | 'limited' | 'very_limited' | 'banned';
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  about: string;
  created_at?: string;
  pronouns?: string;
  status_text?: string;
  status_emoji?: string;
  presence?: PresenceStatus;
  banner_color?: string | null;
  banner_color2?: string | null;
  accent_color?: string | null;
  nameplate?: string;
  tag_server_id?: string | null;
  server_tag?: string | null;
  badges?: string[];
  platform_role?: PlatformRole;
  account_status?: AccountStatus;
  language?: string;
  onboarded?: boolean;
}

/** Columns other people may read (keep in sync with directory.loadProfiles). */
export const PROFILE_COLUMNS =
  'id, username, display_name, avatar_color, about, created_at, pronouns, status_text, status_emoji, presence, banner_color, banner_color2, accent_color, nameplate, tag_server_id, server_tag, badges, platform_role, account_status';

export type ServerStatus = 'active' | 'review' | 'closed' | 'banned' | 'deleted';

export interface Server {
  id: string;
  name: string;
  owner_id: string;
  icon_color: string;
  created_at: string;
  description?: string;
  tag?: string | null;
  banner_color?: string | null;
  verified?: boolean;
  status?: ServerStatus;
  discoverable?: boolean;
  welcome_channel_id?: string | null;
  automod?: { slurs?: boolean };
  categories?: string[];
  icon_url?: string | null;
  banner_url?: string | null;
  log_retention_days?: number;
  vanity?: string | null;
  theme?: ServerTheme;
  welcome?: { message?: string; buttons?: { label: string; channel_id: string; emoji?: string }[] };
  rules?: string[];
  onboarding?: { questions?: { title: string; multi?: boolean; options: { label: string; emoji?: string; role_ids: string[] }[] }[] };
  verification?: { level?: 'none' | 'email' | 'account_age' | 'voogle'; min_account_days?: number };
  voogle?: import('./voogle').VoogleSettings;
  join_mode?: 'open' | 'invite' | 'discovery' | 'private';
  joins_paused?: boolean;
  public_preview?: boolean;
  language?: string;
  category_tags?: string[];
  discovery_status?: 'none' | 'pending' | 'approved' | 'rejected';
}

/** A server's own look (applied over yours unless you turn it off). */
export interface ServerTheme {
  accent?: string;
  bg?: string;
  surface?: string;
  text?: string;
  channel?: string;
  category?: string;
  banner_gradient?: [string, string];
  /** per-category colors */
  categories?: Record<string, string>;
}

export type ChannelType = 'text' | 'voice' | 'dm' | 'forum' | 'announcement' | 'stage';

export interface Channel {
  id: string;
  server_id: string | null;
  type: ChannelType;
  name: string;
  topic: string;
  category: string;
  position: number;
  is_private: boolean;
  is_group?: boolean;
  request_to?: string | null;
  key_rotation_needed: boolean;
  created_at: string;
  settings?: { bitrate?: number; user_limit?: number; video?: boolean; tags?: string[]; sort?: 'recent' | 'created'; guidelines?: string };
  color?: string | null;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  is_default: boolean;
  hoist: boolean;
  icon?: string | null;
  color2?: string | null;
  description?: string;
  mentionable?: boolean;
}

export interface Member {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
  timeout_until?: string | null;
  timeout_reason?: string | null;
}

export interface MemberRole {
  server_id: string;
  user_id: string;
  role_id: string;
}

export interface Invite {
  code: string;
  server_id: string;
  created_by: string;
  uses: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string;
}

export interface Ban {
  server_id: string;
  user_id: string;
  reason: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  author_key_id: string;
  epoch: number;
  iv: string;
  ciphertext: string;
  signature: string;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  thread_root?: string | null;
}

export interface UserKey {
  key_id: string;
  user_id: string;
  enc_public: string;
  sign_public: string;
  created_at: string;
  revoked_at: string | null;
}

export interface DmChannel {
  channel: Channel;
  /** 1:1 DM: the other person. Group: null. */
  other: Profile | null;
  /** everyone else in the conversation */
  members: Profile[];
  /** what to show as the conversation's name */
  title: string;
}
