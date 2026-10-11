// Settings → Notifications, Accessibility, Keybinds, Activity Privacy,
// Streamer Mode and Advanced.
import { useEffect, useState } from 'react';
import { updateChat, updateSettings, useSettings, type Settings } from '../lib/settings';
import { askForNotifications, notificationPermission, playMessageSound, startRing, stopRing } from '../lib/notify';
import { SHORTCUTS } from '../lib/shortcuts';
import { VERSION } from '../lib/version';
import { sessionStore } from '../lib/session';
import { copyText } from './ContextMenu';
import { askConfirm } from './Dialogs';
import { Section, Slider, Toggle } from './SettingsBits';
import { Select } from './Select';

const setN = (p: Partial<Settings['notifications']>) => updateSettings((s) => ({ notifications: { ...s.notifications, ...p } }));
const setA = (p: Partial<Settings['accessibility']>) => updateSettings((s) => ({ accessibility: { ...s.accessibility, ...p } }));
const setS = (p: Partial<Settings['streamer']>) => updateSettings((s) => ({ streamer: { ...s.streamer, ...p } }));
const setAdv = (p: Partial<Settings['advanced']>) => updateSettings((s) => ({ advanced: { ...s.advanced, ...p } }));

export function NotificationsTab() {
  const n = useSettings((s) => s.notifications);
  const [perm, setPerm] = useState(notificationPermission());
  const [ringing, setRinging] = useState(false);
  useEffect(() => () => stopRing('incoming'), []);
  return (
    <>
      <h2>Notifications</h2>
      <Section title="Pop-ups" desc="When Venband isn’t the window you’re looking at.">
        <Toggle label="Desktop notifications" desc="DMs, @mentions and incoming calls." checked={n.desktop} onChange={(v) => setN({ desktop: v })} />
        {n.desktop && perm !== 'granted' && perm !== 'unsupported' && (
          <div className="notice small row">
            <span className="grow">{perm === 'denied' ? 'Your browser blocks Venband’s notifications. Allow them in the site settings (the lock icon next to the address).' : 'Venband needs permission to show notifications.'}</span>
            {perm === 'default' && (
              <button className="btn primary small" onClick={async () => setPerm(await askForNotifications())}>
                Allow
              </button>
            )}
          </div>
        )}
        <Toggle label="Show message text" desc="Off: pop-ups only say who wrote, not what." checked={n.preview} onChange={(v) => setN({ preview: v })} />
        <Toggle label="Flash the taskbar" desc="Desktop app: the Venband button flashes for mentions and calls." checked={n.flashTaskbar} onChange={(v) => setN({ flashTaskbar: v })} />
      </Section>
      <Section title="Sounds">
        <Toggle label="New messages (DMs)" checked={n.messageSound} onChange={(v) => setN({ messageSound: v })} />
        <Toggle label="@mentions and replies" checked={n.mentionSound} onChange={(v) => setN({ mentionSound: v })} />
        <Toggle label="Calls (ringtone)" checked={n.callSound} onChange={(v) => setN({ callSound: v })} />
        <Toggle label="People joining and leaving calls" checked={n.joinLeaveSound} onChange={(v) => setN({ joinLeaveSound: v })} />
        <Slider label="Volume" value={n.volume} onChange={(v) => setN({ volume: v })} />
        <div className="row wrap">
          <button className="btn secondary small" onClick={() => playMessageSound(true)}>
            Play a test sound
          </button>
        </div>
      </Section>
      <Section title="Ringtone" desc="What you hear when someone calls you.">
        <div className="row wrap">
          <Select
            value={n.ringtone}
            ariaLabel="Ringtone"
            onChange={(v) => setN({ ringtone: v as Settings['notifications']['ringtone'] })}
            options={[
              { value: 'venband', label: 'Venband (warm marimba)' },
              { value: 'soft', label: 'Soft (gentle bells)' },
              { value: 'classic', label: 'Classic (phone ring)' },
              { value: 'pulse', label: 'Pulse (low synth)' },
            ]}
          />
          <button
            className="btn secondary small"
            onClick={() => {
              if (ringing) stopRing('incoming');
              else startRing('incoming', true);
              setRinging(!ringing);
            }}
          >
            {ringing ? 'Stop' : 'Preview'}
          </button>
        </div>
      </Section>
    </>
  );
}

export function AccessibilityTab() {
  const a = useSettings((s) => s.accessibility);
  const reduceMotion = useSettings((s) => s.chat.reduceMotion);
  return (
    <>
      <h2>Accessibility</h2>
      <Section title="Size" desc="Make everything bigger or smaller.">
        <Slider label="App zoom" value={a.uiScale} min={70} max={150} step={5} onChange={(v) => setA({ uiScale: v })} />
        <div className="row wrap">
          {[90, 100, 115, 130].map((z) => (
            <button key={z} className={`chip${a.uiScale === z ? ' active' : ''}`} onClick={() => setA({ uiScale: z })}>
              {z}%
            </button>
          ))}
        </div>
        <Toggle label="Roomy layout" desc="More space between messages, channels and buttons; easier to tap." checked={a.roomy} onChange={(v) => setA({ roomy: v })} />
      </Section>
      <Section title="Reading">
        <Toggle label="Easy-reading font" desc="Atkinson Hyperlegible: letters that are hard to mix up." checked={a.readableFont} onChange={(v) => setA({ readableFont: v })} />
        <Toggle label="Underline links" checked={a.underlineLinks} onChange={(v) => setA({ underlineLinks: v })} />
        <Toggle label="High contrast" desc="Stronger text and borders." checked={a.highContrast} onChange={(v) => setA({ highContrast: v })} />
        <Slider label="Colour saturation" value={a.saturation} onChange={(v) => setA({ saturation: v })} />
      </Section>
      <Section title="Motion and focus">
        <Toggle label="Reduce motion" desc="Turn off animations and transitions." checked={reduceMotion} onChange={(v) => updateChat({ reduceMotion: v })} />
        <Toggle label="Always show the keyboard focus" desc="A clear outline around whatever the keyboard is on." checked={a.focusRings} onChange={(v) => setA({ focusRings: v })} />
      </Section>
    </>
  );
}

export function KeybindsTab() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <>
      <h2>Keyboard Shortcuts</h2>
      <p className="muted small">On a Mac, use ⌘ where it says Ctrl. Press Ctrl + / any time to come back here.</p>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <div className="keybind-list">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.keys + s.action} className="keybind-row">
                <span>{s.action}</span>
                <span className="keybind-keys">
                  {s.keys.split(' + ').map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

export function ActivityTab() {
  const share = useSettings((s) => s.advanced.shareActivity);
  const desktop = Boolean(window.venbandDesktop?.isDesktop);
  return (
    <>
      <h2>Activity Privacy</h2>
      <Section title="Share what you’re doing" desc="The game you’re playing or the music you’re listening to, shown on your profile and in member lists.">
        <Toggle
          label="Share my activity"
          desc="Only people who can see your profile (friends and people in your servers) see it."
          checked={share !== false}
          onChange={(v) => setAdv({ shareActivity: v })}
        />
      </Section>
      <Section title="Where it comes from">
        <ul className="security-list">
          <li>
            <b>Games:</b> {desktop ? 'the Venband desktop app recognises games running on this computer (Steam, Epic Games, Minecraft, Fortnite and many more).' : 'install the Venband desktop app so it can recognise the games you play.'}
          </li>
          <li>
            <b>Music:</b> {desktop ? 'Spotify and other players that report what’s playing to your computer.' : 'the desktop app reads what Spotify is playing.'}
          </li>
          <li>
            <b>Apps:</b> tools with rich presence (like code editors) can report what you’re working on through the desktop app.
          </li>
        </ul>
        <p className="small muted">Venband only sees the name of the game or song, never anything else on your computer.</p>
      </Section>
    </>
  );
}

export function StreamerTab() {
  const s = useSettings((x) => x.streamer);
  return (
    <>
      <h2>Streamer Mode</h2>
      <p className="muted small">Hide personal things while you stream or share your screen. A purple STREAMER badge shows while it’s on.</p>
      <Section title="Turn on">
        <Toggle label="Streamer mode" checked={s.enabled} onChange={(v) => setS({ enabled: v })} />
        <Toggle label="Turn on automatically while I share my screen" checked={s.autoOnShare} onChange={(v) => setS({ autoOnShare: v })} />
      </Section>
      <Section title="While it’s on">
        <Toggle label="Hide personal information" desc="Your email, connected accounts and the text of notification pop-ups." checked={s.hidePersonal} onChange={(v) => setS({ hidePersonal: v })} />
        <Toggle label="Hide invite links" desc="So viewers can’t join your servers from your screen." checked={s.hideInvites} onChange={(v) => setS({ hideInvites: v })} />
        <Toggle label="Mute message sounds" desc="Calls still ring." checked={s.mute} onChange={(v) => setS({ mute: v })} />
      </Section>
    </>
  );
}

export function AdvancedTab() {
  const adv = useSettings((s) => s.advanced);
  const me = sessionStore.use((s) => s.me);
  const [copied, setCopied] = useState(false);
  const info = [
    `Venband ${VERSION}`,
    `App: ${window.venbandDesktop?.isDesktop ? 'desktop' : 'Capacitor' in window ? 'phone' : 'web'}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    `User: ${me?.id ?? '-'}`,
  ].join('\n');
  return (
    <>
      <h2>Advanced</h2>
      <Section title="Developer mode" desc="For bot makers and people who report bugs.">
        <Toggle label="Developer mode" desc="Shows IDs on profiles, servers and channels, and adds “Copy ID” everywhere." checked={adv.developerMode} onChange={(v) => setAdv({ developerMode: v })} />
      </Section>
      <Section title="Troubleshooting">
        <pre className="debug-info">{info}</pre>
        <div className="row wrap">
          <button
            className="btn secondary small"
            onClick={() => {
              copyText(info);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy debug info'}
          </button>
          <button
            className="btn danger small"
            onClick={async () => {
              if (!(await askConfirm({ title: 'Reset this device?', body: 'Clears Venband’s saved settings, drafts and caches on this device and reloads. Your account and messages are not touched.', confirm: 'Reset', danger: true }))) return;
              const keep = Object.keys(localStorage).filter((k) => k.startsWith('sb-') || k.startsWith('venband:identity') || k.startsWith('venband:passkey') || k === 'venband:accounts');
              const saved = Object.fromEntries(keep.map((k) => [k, localStorage.getItem(k)]));
              localStorage.clear();
              for (const [k, v] of Object.entries(saved)) if (v !== null) localStorage.setItem(k, v);
              sessionStorage.clear();
              location.reload();
            }}
          >
            Reset local data
          </button>
        </div>
      </Section>
      <Section title="Safe mode" desc="Starts Venband with custom CSS turned off, in case a style broke something.">
        <a className="btn secondary small" href={`${import.meta.env.BASE_URL}channels/@me?safe=1`}>
          Restart in safe mode
        </a>
      </Section>
    </>
  );
}

/** Words each settings page should be found by in the settings search. */
export const SETTINGS_KEYWORDS: Record<string, string> = {
  account: 'email password username delete account log out two-factor 2fa',
  profile: 'avatar picture banner bio about me pronouns display name nameplate frame status colour',
  privacy: 'privacy safety dms message requests blocked link previews embeds data export',
  security: 'security two-factor 2fa authenticator passkey sessions log out devices password',
  devices: 'devices sessions logged in locations',
  appearance: 'theme dark light colours colors custom css background font chat density',
  voice: 'microphone mic camera webcam speaker volume noise echo push to talk input output',
  chat: 'messages emoji shortcode spell check autocorrect drafts enter send gif embeds clock code',
  language: 'language translate translation',
  'my-apps': 'bots apps connected',
  connections: 'steam spotify twitch github connected accounts',
  notifications: 'notifications sounds pop-ups ringtone volume desktop taskbar mentions',
  accessibility: 'accessibility zoom size font contrast motion animations saturation focus underline',
  keybinds: 'keyboard shortcuts keys hotkeys keybinds',
  activity: 'activity games playing spotify music rich presence share',
  streamer: 'streamer streaming obs hide personal invite',
  advanced: 'developer mode debug ids reset safe mode version',
};

export function settingsMatch(id: string, label: string, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = `${label} ${SETTINGS_KEYWORDS[id] ?? ''}`.toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}
