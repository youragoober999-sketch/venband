export interface RealtimeAuth {
  user(token: string): Promise<{ id: string } | null>;
  allowed(token: string, topic: string): Promise<boolean>;
}
export function supabaseAuth(opts: { url: string; anonKey: string; fetchImpl?: typeof fetch }): RealtimeAuth;
export function createRealtimeServer(opts: {
  auth: RealtimeAuth;
  port?: number;
  host?: string;
  allowOrigins?: string[] | null;
  log?: (...a: unknown[]) => void;
}): Promise<{ port: number; stats: { connections: number; frames: number }; close(): Promise<void> }>;
