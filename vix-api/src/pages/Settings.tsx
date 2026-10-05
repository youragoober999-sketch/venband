import { useState } from 'react'
import { A, Avatar, Button, Field, Icon, Segmented, Switch, ask, useAsync } from '../components/ui'
import { api, ApiError, type User } from '../lib/api'
import { t, UI_LANGUAGES } from '../lib/i18n'
import { navigate } from '../lib/router'
import { useApp } from '../lib/store'
import { ACCENTS, DEFAULT_SETTINGS, THEMES, type Settings } from '../lib/settings'
import { cx, downloadBlob, timeAgo } from '../lib/util'

const SECTIONS = [
  { id: 'account', icon: 'user', key: 'settings.account' as const },
  { id: 'appearance', icon: 'sun', key: 'settings.appearance' as const },
  { id: 'accessibility', icon: 'eye', key: 'settings.accessibility' as const },
  { id: 'editor', icon: 'terminal', key: 'settings.editor' as const },
  { id: 'language', icon: 'globe', key: 'settings.language' as const },
  { id: 'security', icon: 'shield', key: 'settings.security' as const },
  { id: 'data', icon: 'database', key: 'settings.data' as const },
]

export function SettingsPage({ section = 'account' }: { section?: string }) {
  const active = SECTIONS.find((s) => s.id === section) || SECTIONS[0]
  return (
    <div className="page settings-page">
      <h1>{t('settings.title')}</h1>
      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-nav">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <A href={`/settings/${s.id}`} className={cx('nav-link', s.id === active.id && 'active')} aria-current={s.id === active.id ? 'page' : undefined}>
                  <Icon name={s.icon} /> {t(s.key)}
                </A>
              </li>
            ))}
          </ul>
        </nav>
        <section className="settings-body" aria-labelledby="settings-h">
          <h2 id="settings-h">{t(active.key)}</h2>
          {active.id === 'account' && <Account />}
          {active.id === 'appearance' && <Appearance />}
          {active.id === 'accessibility' && <Accessibility />}
          {active.id === 'editor' && <EditorPrefs />}
          {active.id === 'language' && <Language />}
          {active.id === 'security' && <Security />}
          {active.id === 'data' && <DataSection />}
        </section>
      </div>
    </div>
  )
}

function Account() {
  const { user, setUser, toast } = useApp()
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [color, setColor] = useState(user?.avatar_color || ACCENTS[0])
  const [busy, setBusy] = useState(false)
  if (!user) return null
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api.patch<{ user: User }>('/me', { display_name: displayName, bio, avatar_color: color })
      setUser({ ...user!, ...r.user })
      toast('Profile saved', 'success')
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <div className="profile-preview">
        <Avatar user={{ ...user, display_name: displayName, avatar_color: color }} size={56} />
        <div><strong>{displayName || user.username}</strong><div className="hint">@{user.username} · joined {new Date(user.created_at).toLocaleDateString()}</div></div>
      </div>
      <Field label="Display name">{(p) => <input {...p} className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />}</Field>
      <Field label="Bio" hint="Shown on your public profile.">{(p) => <textarea {...p} className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} />}</Field>
      <fieldset>
        <legend>Avatar color</legend>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <label key={c} className={cx('swatch', color === c && 'selected')} style={{ background: c }}>
              <input type="radio" name="avatar" className="sr-only-input" checked={color === c} onChange={() => setColor(c)} />
              <span className="sr-only">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint">Your username <code>{user.username}</code> is part of your API URLs, so it can't be changed.</p>
      <div><Button type="submit" variant="primary" loading={busy}>{t('common.save')}</Button></div>
    </form>
  )
}

function Appearance() {
  const { settings, updateSettings } = useApp()
  return (
    <div className="stack">
      <fieldset>
        <legend>Theme</legend>
        <div className="theme-grid">
          {THEMES.map((th) => (
            <label key={th.id} className={cx('theme-card', settings.theme === th.id && 'selected')} data-preview={th.id}>
              <input type="radio" name="theme" className="sr-only-input" checked={settings.theme === th.id} onChange={() => updateSettings({ theme: th.id })} />
              <span className="theme-swatch" aria-hidden="true"><span /><span /><span /></span>
              <span>{th.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Accent color</legend>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <label key={c} className={cx('swatch', settings.accent === c && 'selected')} style={{ background: c }}>
              <input type="radio" name="accent" className="sr-only-input" checked={settings.accent === c} onChange={() => updateSettings({ accent: c })} />
              <span className="sr-only">{c}</span>
            </label>
          ))}
          <label className="swatch custom-swatch">
            <span className="sr-only">Custom color</span>
            <input type="color" value={settings.accent} onChange={(e) => updateSettings({ accent: e.target.value })} />
          </label>
        </div>
        <p className="hint">High contrast themes use their own accessible accent.</p>
      </fieldset>
    </div>
  )
}

function Range({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <Field label={<>{label}: <strong>{format(value)}</strong></>}>
      {(p) => (
        <div className="range-row">
          <button type="button" className="icon-btn" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))}><Icon name="x" size={12} /></button>
          <input {...p} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
          <button type="button" className="icon-btn" aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, +(value + step).toFixed(3)))}><Icon name="plus" size={12} /></button>
        </div>
      )}
    </Field>
  )
}

function Accessibility() {
  const { settings, updateSettings } = useApp()
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>)
  return (
    <div className="stack">
      <p className="hint">These settings follow your account to every device. Vix Api also respects your system's reduced motion, contrast and color scheme preferences.</p>
      <Range label="Text size" value={settings.fontScale} min={0.8} max={1.6} step={0.05} onChange={set('fontScale')} format={(v) => `${Math.round(v * 100)}%`} />
      <Range label="Line spacing" value={settings.lineHeight} min={1.2} max={2.2} step={0.1} onChange={set('lineHeight')} format={(v) => v.toFixed(1)} />
      <Range label="Letter spacing" value={settings.letterSpacing} min={0} max={0.15} step={0.01} onChange={set('letterSpacing')} format={(v) => `${v.toFixed(2)} em`} />
      <Field label="Font">
        {(p) => (
          <select {...p} className="input" value={settings.font} onChange={(e) => updateSettings({ font: e.target.value as Settings['font'] })}>
            <option value="inter">Inter (default)</option>
            <option value="atkinson">Atkinson Hyperlegible (low vision)</option>
            <option value="dyslexic">OpenDyslexic (dyslexia-friendly)</option>
            <option value="system">My system font</option>
          </select>
        )}
      </Field>
      <div>
        <span className="field-label">Animations</span>
        <Segmented label="Animations" value={settings.reduceMotion} onChange={set('reduceMotion')} options={[{ value: 'system', label: 'Follow system' }, { value: 'on', label: 'Reduce' }, { value: 'off', label: 'Allow' }]} />
      </div>
      <Field label="Color vision" hint="Swaps success/error colors for palettes that stay distinct. Status is always shown with text and icons too.">
        {(p) => (
          <select {...p} className="input" value={settings.colorVision} onChange={(e) => updateSettings({ colorVision: e.target.value as Settings['colorVision'] })}>
            <option value="none">Standard</option>
            <option value="protanopia">Protanopia (red-blind)</option>
            <option value="deuteranopia">Deuteranopia (green-blind)</option>
            <option value="tritanopia">Tritanopia (blue-blind)</option>
          </select>
        )}
      </Field>
      <Switch checked={settings.underlineLinks} onChange={set('underlineLinks')} label="Always underline links" />
      <Switch checked={settings.boldFocus} onChange={set('boldFocus')} label="Extra-visible focus ring" description="A thick, high-contrast outline around whatever has keyboard focus." />
      <Switch checked={settings.largeTargets} onChange={set('largeTargets')} label="Larger buttons and touch targets" description="Makes every button at least 44×44 pixels." />
      <Switch checked={settings.srVerbose} onChange={set('srVerbose')} label="Detailed screen reader announcements" description="Announces save, run results and output length as they happen." />
      <Switch checked={settings.sounds} onChange={set('sounds')} label="Sound cues" description="Short tones when code finishes running (success and error sound different)." />
      <Switch checked={!!settings.extensions['speak-output']} onChange={(v) => updateSettings({ extensions: { ...settings.extensions, 'speak-output': v } })} label="Read sandbox output aloud" description="Uses your device's text-to-speech voice." />
      <p className="hint"><Icon name="keyboard" size={14} /> Press <kbd className="kbd">?</kbd> anywhere to see every keyboard shortcut.</p>
      <div><Button variant="ghost" onClick={() => updateSettings({ fontScale: 1, lineHeight: 1.5, letterSpacing: 0, font: 'inter', reduceMotion: 'system', underlineLinks: false, boldFocus: false, largeTargets: false, colorVision: 'none' })}>Reset accessibility settings</Button></div>
    </div>
  )
}

function EditorPrefs() {
  const { settings, updateSettings, setExtension } = useApp()
  return (
    <div className="stack">
      <Range label="Editor font size" value={settings.editorFontSize} min={10} max={28} step={1} onChange={(v) => updateSettings({ editorFontSize: v })} format={(v) => `${v}px`} />
      <Field label="Editor font">
        {(p) => (
          <select {...p} className="input" value={settings.editorFont} onChange={(e) => updateSettings({ editorFont: e.target.value as Settings['editorFont'] })}>
            <option value="jetbrains">JetBrains Mono</option>
            <option value="system-mono">System monospace</option>
            <option value="dyslexic">OpenDyslexic Mono-style</option>
          </select>
        )}
      </Field>
      <div>
        <span className="field-label">Tab size</span>
        <Segmented label="Tab size" value={String(settings.tabSize) as '2' | '4' | '8'} onChange={(v) => updateSettings({ tabSize: Number(v) })} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }]} />
      </div>
      <Switch checked={settings.lineNumbers} onChange={(v) => updateSettings({ lineNumbers: v })} label="Line numbers and code folding" />
      <Switch checked={settings.cursorBlink} onChange={(v) => updateSettings({ cursorBlink: v })} label="Blinking cursor" />
      <Switch checked={!!settings.extensions.autosave} onChange={(v) => setExtension('autosave', v)} label="Auto save" description="Saves a moment after you stop typing." />
      <Range label="Auto save delay" value={settings.autosaveDelay} min={400} max={5000} step={100} onChange={(v) => updateSettings({ autosaveDelay: v })} format={(v) => `${(v / 1000).toFixed(1)} s`} />
      <p className="hint">More options - Vim keys, rainbow brackets, snippets, zen mode - are on the <A href="/extensions">Extensions</A> page.</p>
    </div>
  )
}

function Language() {
  const { settings, updateSettings } = useApp()
  return (
    <div className="stack">
      <fieldset>
        <legend className="sr-only">{t('settings.language')}</legend>
        <div className="lang-grid">
          {UI_LANGUAGES.map((l) => (
            <label key={l.code} className={cx('lang-card', settings.language === l.code && 'selected')} lang={l.code} dir={l.dir || 'ltr'}>
              <input type="radio" name="lang" className="sr-only-input" checked={settings.language === l.code} onChange={() => updateSettings({ language: l.code })} />
              {l.name}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint">Programming languages are separate: Vix Api runs 40+ of them no matter which interface language you choose.</p>
    </div>
  )
}

function Security() {
  const { toast, signOut } = useApp()
  const sessions = useAsync(() => api.get<{ sessions: { id: string; user_agent: string; created_at: string; current: boolean }[] }>('/auth/sessions'), [])
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 8) return toast('New password needs at least 8 characters', 'error')
    setBusy(true)
    try {
      await api.post('/me/password', { current: cur, password: next })
      toast('Password changed. Other devices were signed out.', 'success')
      setCur('')
      setNext('')
      sessions.reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <form className="stack" onSubmit={change}>
        <h3>Change password</h3>
        <Field label="Current password">{(p) => <input {...p} className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />}</Field>
        <Field label="New password">{(p) => <input {...p} className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</Field>
        <div><Button type="submit" variant="primary" loading={busy}>Change password</Button></div>
      </form>
      <h3>Signed-in devices</h3>
      <ul className="session-list">
        {(sessions.data?.sessions || []).map((s) => (
          <li key={s.id}>
            <Icon name="layout" />
            <div><strong>{describeAgent(s.user_agent)}</strong> {s.current && <span className="badge badge-good">This device</span>}<div className="hint">Signed in {timeAgo(s.created_at)}</div></div>
            {!s.current && <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); sessions.reload() }}>Sign out</Button>}
          </li>
        ))}
      </ul>
      <div><Button variant="danger" onClick={async () => { if (await ask({ title: 'Sign out everywhere?', body: 'Every device, including this one, will be signed out. Your APIs keep running.', confirm: 'Sign out everywhere', danger: true })) { await api.post('/auth/logout-all'); await signOut(); navigate('/') } }}>Sign out of all devices</Button></div>
    </div>
  )
}

function describeAgent(ua: string) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|python|node/i.test(ua) ? 'Script' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function DataSection() {
  const { toast, signOut, updateSettings } = useApp()
  const [pw, setPw] = useState('')
  return (
    <div className="stack">
      <h3>Export everything</h3>
      <p className="hint">Download all your APIs, files and endpoints as JSON. Each API can also be exported as a .zip from its workspace.</p>
      <div><Button icon="download" onClick={async () => { const data = await api.get('/me/export'); downloadBlob(`vix-api-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); toast('Export downloaded', 'success') }}>Download my data</Button></div>
      <h3>Reset preferences</h3>
      <div><Button variant="ghost" onClick={() => { updateSettings({ ...DEFAULT_SETTINGS }); toast('Preferences reset', 'success') }}>Reset all settings to defaults</Button></div>
      <h3 className="danger-title">Delete account</h3>
      <p className="hint">Deletes your account, every API you own (they stop answering immediately), your keys and your friends list. This cannot be undone.</p>
      <Field label="Type your password to confirm">{(p) => <input {...p} className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}</Field>
      <div>
        <Button variant="danger" disabled={!pw} onClick={async () => {
          if (!(await ask({ title: 'Delete your account forever?', body: 'All of your APIs will go offline and be deleted.', confirm: 'Delete my account', danger: true }))) return
          try {
            await api.del('/me', { password: pw })
            await signOut()
            navigate('/')
          } catch (err) {
            toast(err instanceof ApiError ? err.message : String(err), 'error')
          }
        }}>Delete my account</Button>
      </div>
    </div>
  )
}
