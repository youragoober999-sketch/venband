import { useEffect, useRef, useState } from 'react';
import { sessionStore } from '../lib/session';
import { leaveCall, type RemotePeer } from '../lib/call';
import { displayName, getProfile } from '../lib/directory';
import { has, P } from '../lib/permissions';
import type { ServerData } from '../hooks/data';
import { useActiveCall } from './Shell';
import { Avatar, Icon } from './ui';

/** Plays every remote audio stream while in a call (kept mounted app-wide). */
export function CallAudio() {
  const call = useActiveCall();
  if (!call) return null;
  return (
    <div hidden>
      {call.remotePeers.flatMap((p) =>
        [...p.streams.values()]
          .filter((s) => s.getAudioTracks().length > 0)
          .map((s) => <AudioSink key={`${p.session}-${s.id}`} stream={s} muted={call.deafened} />),
      )}
    </div>
  );
}

function AudioSink({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

function useSpeaking(stream: MediaStream | null, enabled = true) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream || !enabled || !stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const t = setInterval(() => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setSpeaking(avg > 12);
    }, 150);
    return () => {
      clearInterval(t);
      ctx.close();
    };
  }, [stream, enabled]);
  return speaking;
}

interface Tile {
  key: string;
  userId: string;
  kind: 'user' | 'screen';
  video: MediaStream | null;
  audio: MediaStream | null;
  muted: boolean;
  deafened: boolean;
  local: boolean;
}

function tilesFor(peer: RemotePeer): Tile[] {
  const meta = peer.meta;
  const mic = meta ? peer.streams.get(meta.mic) ?? null : null;
  const cam = meta?.cam ? peer.streams.get(meta.cam) ?? null : null;
  const screen = meta?.screen ? peer.streams.get(meta.screen) ?? null : null;
  const tiles: Tile[] = [
    {
      key: peer.session,
      userId: peer.userId,
      kind: 'user',
      video: cam && cam.getVideoTracks().length ? cam : null,
      audio: mic,
      muted: meta?.muted ?? false,
      deafened: meta?.deafened ?? false,
      local: false,
    },
  ];
  if (screen && screen.getVideoTracks().length) {
    tiles.push({ key: `${peer.session}-screen`, userId: peer.userId, kind: 'screen', video: screen, audio: null, muted: false, deafened: false, local: false });
  }
  return tiles;
}

export function VoiceView({ data, compact }: { data?: ServerData; compact?: boolean }) {
  const call = useActiveCall();
  const me = sessionStore.use((s) => s.me)!;
  const [focus, setFocus] = useState<string | null>(null);
  if (!call) return null;

  const tiles: Tile[] = [
    { key: 'me', userId: me.id, kind: 'user', video: call.cam, audio: call.mic, muted: call.muted, deafened: call.deafened, local: true },
    ...(call.screen ? [{ key: 'me-screen', userId: me.id, kind: 'screen' as const, video: call.screen, audio: null, muted: false, deafened: false, local: true }] : []),
    ...call.remotePeers.flatMap(tilesFor),
  ];
  const focused = tiles.find((t) => t.key === focus) ?? null;
  const canVideo = !data || has(data.myPermissions, P.VIDEO);
  const nameOf = (id: string) => displayName(id, data?.members.find((m) => m.user_id === id)?.nickname);

  return (
    <div className={`voice-view${compact ? ' compact' : ''}`}>
      {!compact && (
        <header className="chat-header">
          <Icon name="speaker" />
          <h3>{call.channelName}</h3>
          <span className="lock-hint" title="Calls go directly between participants and are encrypted end to end.">
            <Icon name="lock" size={13} />
          </span>
        </header>
      )}
      {call.error && <div className="call-error">{call.error}</div>}
      <div className={`tiles${focused ? ' has-focus' : ''}`}>
        {focused && (
          <div className="focus-area">
            <VideoTile tile={focused} name={nameOf(focused.userId)} onClick={() => setFocus(null)} big />
          </div>
        )}
        <div className="tile-grid" data-count={tiles.length}>
          {tiles
            .filter((t) => t.key !== focus)
            .map((t) => (
              <VideoTile key={t.key} tile={t} name={nameOf(t.userId)} onClick={() => setFocus(t.key)} />
            ))}
        </div>
      </div>
      <div className="call-controls">
        <button className={`round-btn${call.muted ? ' off' : ''}`} onClick={() => call.toggleMute()} title={call.muted ? 'Unmute' : 'Mute'}>
          <Icon name={call.muted ? 'micOff' : 'mic'} />
        </button>
        <button className={`round-btn${call.deafened ? ' off' : ''}`} onClick={() => call.toggleDeafen()} title="Deafen">
          <Icon name={call.deafened ? 'headphonesOff' : 'headphones'} />
        </button>
        <button className={`round-btn${call.cam ? ' on' : ''}`} disabled={!canVideo} onClick={() => call.toggleCamera()} title="Camera">
          <Icon name={call.cam ? 'video' : 'videoOff'} />
        </button>
        <button className={`round-btn${call.screen ? ' on' : ''}`} disabled={!canVideo} onClick={() => call.toggleScreen()} title="Share screen">
          <Icon name="screen" />
        </button>
        <button className="round-btn hangup" onClick={() => leaveCall()} title="Disconnect">
          <Icon name="phoneOff" />
        </button>
      </div>
    </div>
  );
}

function VideoTile({ tile, name, onClick, big }: { tile: Tile; name: string; onClick: () => void; big?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const speaking = useSpeaking(tile.audio, !tile.muted);
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const on = () => setIsFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = (e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.current?.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    if (ref.current && tile.video) {
      ref.current.srcObject = tile.video;
      ref.current.play().catch(() => {});
    }
  }, [tile.video]);
  return (
    <div
      ref={box}
      className={`tile${speaking ? ' speaking' : ''}${big ? ' big' : ''}${tile.kind === 'screen' ? ' screen' : ''}${isFull ? ' fullscreen' : ''}`}
      onClick={isFull ? undefined : onClick}
      onDoubleClick={tile.video ? toggleFull : undefined}
    >
      {tile.video ? (
        <video ref={ref} autoPlay playsInline muted className={tile.local && tile.kind === 'user' ? 'mirror' : ''} />
      ) : (
        <Avatar profile={getProfile(tile.userId)} size={big ? 96 : 72} speaking={speaking} />
      )}
      <div className="tile-label">
        {tile.kind === 'screen' && <span className="live-badge">LIVE</span>}
        {name}
        {tile.kind === 'screen' ? '’s screen' : ''}
        {tile.deafened ? <Icon name="headphonesOff" size={14} /> : tile.muted ? <Icon name="micOff" size={14} /> : null}
      </div>
      {tile.video && (
        <button className="tile-full" onClick={toggleFull} title={isFull ? 'Exit full screen (Esc)' : 'Full screen'}>
          <Icon name={isFull ? 'minimize' : 'maximize'} size={16} />
        </button>
      )}
    </div>
  );
}
