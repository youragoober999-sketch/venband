import { useState } from 'react';
import { sessionStore, updateMyProfile } from '../lib/session';
import { updateSettings, useSettings } from '../lib/settings';
import { BUILT_IN_THEMES } from '../lib/themes';
import { LANGUAGES, translationSupported } from '../lib/translate';
import { errorMessage } from '../lib/supabase';
import { Avatar, ColorPicker, Field, Icon, Logo } from './ui';

/** First-run setup after signing up: language, translation, profile, theme. */
export function Onboarding() {
  const me = sessionStore.use((s) => s.me)!;
  const themeId = useSettings((s) => s.themeId);
  const mode = useSettings((s) => s.translateMode);
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState(() => {
    const nav = navigator.language.split('-')[0];
    return LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
  });
  const [displayName, setDisplayName] = useState(me.display_name);
  const [pronouns, setPronouns] = useState(me.pronouns ?? '');
  const [about, setAbout] = useState(me.about ?? '');
  const [color, setColor] = useState(me.avatar_color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(skip = false) {
    setBusy(true);
    setError(null);
    try {
      updateSettings({ language });
      await updateMyProfile(
        skip
          ? { onboarded: true, language }
          : { onboarded: true, language, display_name: displayName.trim() || me.username, pronouns, about, avatar_color: color },
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const steps = ['Language', 'Profile', 'Look'];
  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-top">
          <Logo size={40} />
          <div className="onboarding-steps">
            {steps.map((s, i) => (
              <span key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
                {s}
              </span>
            ))}
          </div>
          <button className="btn link" disabled={busy} onClick={() => finish(true)}>
            Skip for now
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}

        {step === 0 && (
          <div className="onboarding-step" key="lang">
            <h1>Welcome to Venband, {me.display_name}.</h1>
            <p className="muted">Pick your language. Messages in other languages can be translated into it, right on your device.</p>
            <div className="language-grid">
              {LANGUAGES.map((l) => (
                <button key={l.code} className={`language-option${language === l.code ? ' selected' : ''}`} onClick={() => setLanguage(l.code)}>
                  <b>{l.native}</b>
                  <span className="small muted">{l.name}</span>
                </button>
              ))}
            </div>
            <div className="field-label">Translate messages</div>
            <div className="seg">
              {(
                [
                  ['auto', 'Automatically'],
                  ['manual', 'When I ask'],
                  ['off', 'Never'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={mode === id ? 'active' : ''} onClick={() => updateSettings({ translateMode: id })}>
                  {label}
                </button>
              ))}
            </div>
            {!translationSupported() && <p className="small muted">Translation needs a recent Chrome or Edge. You can change this any time in Settings → Language.</p>}
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step" key="profile">
            <h1>Set up your profile</h1>
            <p className="muted">This is how people see you. You can add a banner, status and more later in Settings.</p>
            <div className="onboarding-profile">
              <Avatar profile={{ display_name: displayName || me.username, avatar_color: color }} size={96} />
              <div className="grow">
                <Field label="Display name">
                  <input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </Field>
                <Field label="Pronouns">
                  <input maxLength={40} value={pronouns} placeholder="she/her, he/him, they/them…" onChange={(e) => setPronouns(e.target.value)} />
                </Field>
              </div>
            </div>
            <Field label="About me">
              <textarea maxLength={190} value={about} placeholder="A little about you" onChange={(e) => setAbout(e.target.value)} />
            </Field>
            <Field label="Avatar color">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step" key="look">
            <h1>Pick a look</h1>
            <p className="muted">Change it whenever you like, or get more from the theme marketplace in Settings → Appearance.</p>
            <div className="onboarding-themes">
              {BUILT_IN_THEMES.map((t) => (
                <button key={t.id} className={`onboarding-theme${themeId === t.id ? ' selected' : ''}`} onClick={() => updateSettings({ themeId: t.id })}>
                  <span className="ot-preview" style={{ background: t.wallpaper ?? t.vars['bg-0'] }}>
                    <span style={{ background: t.vars['bg-2'] }} />
                    <span style={{ background: t.vars.accent }} />
                  </span>
                  <b>{t.name}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="onboarding-actions">
          <button className="btn link onboarding-skip" disabled={busy} onClick={() => finish(true)}>
            Skip setup — I’ll do this later
          </button>
          {step > 0 && (
            <button className="btn secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 2 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              Next <Icon name="chevron" size={14} />
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => finish()}>
              {busy ? 'Saving…' : 'Let’s go'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
