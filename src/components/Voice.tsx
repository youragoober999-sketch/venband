import { useEffect, useRef, useState } from 'react';
import { sessionStore } from '../lib/session';
import { leaveCall, type RemotePeer } from '../lib/call';
import { displayName, getProfile } from '../lib/directory';
import { has, P } from '../lib/permissions';
import { attenuationOf, callUi, mixer, streamKey, voiceKey, volumeOf, type SinkInput } from '../lib/audio';
import { updateLayout, updateSettings, useSettings } from '../lib/settings';
import type { ServerData } from '../hooks/data';
import { useActiveCall } from './Shell';
import { Avatar, Icon } from './ui';
import { openMenu, type MenuItem } from './ContextMenu';
import { Resizer } from './Resizer';

/** Plays every remote audio stream while in a call (kept mounted app-wide). */
export function CallAudio() {
  const call = useActiveCall();
  const hidden = callUi.use((s) => s.hidden);
  useEffect(() => {
    if (!call) {
      mixer.set([], false);
      const cur = callUi.get();
      if (Object.keys(cur.hidden).length || Object.keys(cur.muted).length || cur.selfPreview) callUi.set({ hidden: {}, muted: {}, selfPreview: false });
      return;
    }
    const inputs: SinkInput[] = [];
    for (const p of call.remotePeers) {
      for (const s of p.streams.values()) {
        if (!s.getAudioTracks().length) continue;
        const isScreen = p.meta?.screen === s.id;
        const key = isScreen ? streamKey(p.userId) : voiceKey(p.userId);
        if (isScreen && hidden[key]) continue; // stopped watching: no audio either
        inputs.push({ key, stream: s, kind: isScreen ? 'stream' : 'voice' });
      }
    }
    mixer.set(inputs, call.deafened);
  });
  return null;
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

export function VoiceView({ data, compact, headerExtra }: { data?: ServerData; compact?: boolean; headerExtra?: React.ReactNode }) {
  const call = useActiveCall();
  const me = sessionStore.use((s) => s.me)!;
  const [focus, setFocus] = useState<string | null>(null);
  const callHeight = useSettings((s) => s.layout.callHeight);
  if (!call) return null;

  const tiles: Tile[] = [
    { key: 'me', userId: me.id, kind: 'user', video: call.cam, audio: call.mic, muted: call.muted, deafened: call.deafened, local: true },
    ...(call.screen ? [{ key: 'me-screen', userId: me.id, kind: 'screen' as const, video: call.screen, audio: null, muted: false, deafened: false, local: true }] : []),
    ...call.remotePeers.flatMap(tilesFor),
  ];
  const focused = tiles.find((t) => t.key === focus) ?? null;
  const sharing = tiles.some((t) => t.kind === 'screen');
  const canVideo = !data || has(data.myPermissions, P.VIDEO);
  const nameOf = (id: string) => displayName(id, data?.members.find((m) => m.user_id === id)?.nickname);
  const expanded = compact && (focused || sharing);

  return (
    <div
      className={`voice-view${compact ? ' compact' : ''}${expanded ? ' expanded' : ''}`}
      style={compact ? { height: expanded ? Math.max(callHeight, 360) : callHeight } : undefined}
    >
      {!compact && (
        <header className="chat-header">
          <Icon name="speaker" />
          <h3>{call.channelName}</h3>
          <span className="lock-hint" title="Calls go directly between participants and are encrypted end to end.">
            <Icon name="lock" size={13} />
          </span>
          {headerExtra && <div className="chat-header-actions">{headerExtra}</div>}
        </header>
      )}
      {call.error && <div className="call-error">{call.error}</div>}
      <div className={`tiles${focused ? ' has-focus' : ''}`}>
        {/* One list: focusing a tile only restyles it, it never re-mounts the video */}
        <div className="tile-grid" data-count={tiles.length}>
          {tiles.map((t) => (
            <VideoTile key={t.key} tile={t} name={nameOf(t.userId)} big={t.key === focus} onClick={() => setFocus((f) => (f === t.key ? null : t.key))} />
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
      {compact && <Resizer axis="y" value={callHeight} min={180} max={Math.round(window.innerHeight * 0.8)} onChange={(v) => updateLayout({ callHeight: v })} />}
    </div>
  );
}

function setVolume(key: string, v: number) {
  updateSettings((s) => ({ volumes: { ...s.volumes, [key]: v } }));
}

function VideoTile({ tile, name, onClick, big }: { tile: Tile; name: string; onClick: () => void; big?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const speaking = useSpeaking(tile.audio, !tile.muted);
  const [isFull, setIsFull] = useState(false);
  const key = tile.kind === 'screen' ? streamKey(tile.userId) : voiceKey(tile.userId);
  const hidden = callUi.use((s) => Boolean(s.hidden[key])) && tile.kind === 'screen' && !tile.local;
  const selfPreview = callUi.use((s) => s.selfPreview);
  const ownScreenHidden = tile.local && tile.kind === 'screen' && !selfPreview;
  const locallyMuted = callUi.use((s) => Boolean(s.muted[key]));
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
    if (ref.current && tile.video && !hidden && !ownScreenHidden) {
      ref.current.srcObject = tile.video;
      ref.current.play().catch(() => {});
    }
  }, [tile.video, hidden, ownScreenHidden]);

  function menu(e: React.MouseEvent) {
    const items: (MenuItem | false)[] = [{ type: 'header', label: tile.kind === 'screen' ? `${name}’s screen` : name }];
    if (tile.video && !hidden && !ownScreenHidden) items.push({ label: isFull ? 'Exit full screen' : 'Full screen', icon: isFull ? 'minimize' : 'maximize', onClick: () => toggleFull() });
    if (tile.local && tile.kind === 'screen')
      items.push({ type: 'check', label: 'Show my stream preview', checked: selfPreview, onChange: (v) => callUi.set({ selfPreview: v }) });
    if (!tile.local) {
      items.push(
        { type: 'sep' },
        {
          type: 'slider',
          label: tile.kind === 'screen' ? 'Stream volume' : 'User volume',
          value: volumeOf(key),
          min: 0,
          max: 200,
          step: 5,
          format: (v) => `${v}%`,
          onChange: (v) => setVolume(key, v),
        },
      );
      if (tile.kind === 'screen')
        items.push({
          type: 'slider',
          label: 'Stream attenuation',
          value: attenuationOf(key),
          min: 0,
          max: 100,
          step: 5,
          format: (v) => (v ? `−${v}% while people talk` : 'Off'),
          onChange: (v) => setVolume(`att:${key}`, v),
        });
      items.push({
        type: 'check',
        label: tile.kind === 'screen' ? 'Mute stream' : 'Mute',
        checked: locallyMuted,
        onChange: (v) => callUi.set((s) => ({ muted: { ...s.muted, [key]: v } })),
      });
      if (tile.kind === 'screen')
        items.push({
          label: hidden ? 'Watch stream' : 'Stop watching',
          icon: hidden ? 'eye' : 'eyeOff',
          danger: !hidden,
          onClick: () => {
            if (document.fullscreenElement === box.current) document.exitFullscreen().catch(() => {});
            callUi.set((s) => ({ hidden: { ...s.hidden, [key]: !hidden } }));
          },
        });
    }
    openMenu(e, items);
  }

  return (
    <div
      ref={box}
      className={`tile${speaking ? ' speaking' : ''}${big ? ' big' : ''}${tile.kind === 'screen' ? ' screen' : ''}${isFull ? ' fullscreen' : ''}${hidden ? ' stopped' : ''}`}
      // screen shares: click = real full screen. cameras: click = spotlight, double-click = full screen
      onClick={isFull || hidden || ownScreenHidden ? undefined : tile.kind === 'screen' && tile.video ? () => toggleFull() : onClick}
      onDoubleClick={tile.video && tile.kind !== 'screen' ? toggleFull : undefined}
      onContextMenu={menu}
      title={tile.kind === 'screen' && !isFull && !hidden ? 'Click for full screen · right-click for volume' : undefined}
    >
      {ownScreenHidden ? (
        <div className="tile-stopped">
          <Icon name="screen" size={28} />
          <span>You’re sharing your screen</span>
          <button className="btn small secondary" onClick={(e) => (e.stopPropagation(), callUi.set({ selfPreview: true }))}>
            Show preview
          </button>
        </div>
      ) : hidden ? (
        <div className="tile-stopped">
          <Icon name="eyeOff" size={28} />
          <span>You stopped watching</span>
          <button className="btn small secondary" onClick={() => callUi.set((s) => ({ hidden: { ...s.hidden, [key]: false } }))}>
            Watch stream
          </button>
        </div>
      ) : tile.video ? (
        <video ref={ref} autoPlay playsInline muted className={tile.local && tile.kind === 'user' ? 'mirror' : ''} />
      ) : (
        <Avatar profile={getProfile(tile.userId)} size={big ? 96 : 72} speaking={speaking} />
      )}
      <div className="tile-label">
        {tile.kind === 'screen' && <span className="live-badge">LIVE</span>}
        {name}
        {tile.kind === 'screen' ? '’s screen' : ''}
        {locallyMuted && <Icon name="volumeOff" size={14} />}
        {tile.deafened ? <Icon name="headphonesOff" size={14} /> : tile.muted ? <Icon name="micOff" size={14} /> : null}
      </div>
      {tile.video && !hidden && !ownScreenHidden && (
        <button className={`tile-full${tile.kind === 'screen' ? ' always' : ''}`} onClick={toggleFull} title={isFull ? 'Exit full screen (Esc)' : 'Full screen'}>
          <Icon name={isFull ? 'minimize' : 'maximize'} size={16} />
          {tile.kind === 'screen' && <span>{isFull ? 'Exit' : 'Full screen'}</span>}
        </button>
      )}
      {(!tile.local || tile.kind === 'screen') && (
        <button className="tile-more" title="Volume and more" onClick={(e) => (e.stopPropagation(), menu(e))}>
          <Icon name="more" size={16} />
        </button>
      )}
    </div>
  );
}
