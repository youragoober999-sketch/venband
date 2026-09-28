export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  about: string;
}

export interface Server {
  id: string;
  name: string;
  owner_id: string;
  icon_color: string;
  created_at: string;
}

export type ChannelType = 'text' | 'voice' | 'dm';

export interface Channel {
  id: string;
  server_id: string | null;
  type: ChannelType;
  name: string;
  topic: string;
  category: string;
  position: number;
  is_private: boolean;
  key_rotation_needed: boolean;
  created_at: string;
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
}

export interface Member {
  server_id: string;
  user_id: string;
  nickname: string | null;
  joined_at: string;
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
  other: Profile | null;
}
