// Settings → Appearance → Background & CSS.
import { useEffect, useRef, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { sessionStore } from '../lib/session';
import { updateSettings, useSettings } from '../lib/settings';
import { applyBackground, clearBackground, hasBackground, setBackgroundFile } from '../lib/background';
import { CSS_LIMIT, CSS_TEMPLATES, sanitizeCss } from '../lib/customCss';
import { askText } from './Dialogs';
import { Toggle } from './Settings';
import { Icon } from './ui';

export function LooksPanel() {
  return (
    <>
      <BackgroundSection />
      <CustomCssSection />
    </>
  );
}

function BackgroundSection() {
  const bg = useSettings((s) => s.background);
  const [has, setHas] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    hasBackground().then(setHas);
  }, []);
  const set = (p: Partial<typeof bg>) => updateSettings((s) => ({ background: { ...s.background, ...p } }));
  return (
    <section className="settings-section">
      <h3>Background picture</h3>
      <p className="muted small">Use any picture from your files behind Venband. It stays on this device — it’s never uploaded.</p>
      {msg && <div className="form-error">{msg}</div>}
      <div className="row-start">
        <label className="btn primary small">
          <Icon name="image" size={14} /> {has ? 'Change picture' : 'Choose a picture'}
          <input
            type="file"
            hidden
            accept="image/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                await setBackgroundFile(f);
                setHas(true);
                set({ enabled: true });
                applyBackground();
                setMsg(null);
              } catch (err) {
                setMsg(errorMessage(err));
              }
            }}
          />
        </label>
        {has && (
          <button className="btn secondary small" onClick={() => clearBackground().then(() => (setHas(false), set({ enabled: false })))}>
            Remove
          </button>
        )}
      </div>
      {has && (
        <>
          <Toggle label="Show the background picture" checked={bg.enabled} onChange={(v) => set({ enabled: v })} />
          <label className="slider-row">
            <span>Darken</span>
            <input type="range" min={0} max={85} value={bg.dim} onChange={(e) => set({ dim: Number(e.target.value) })} />
            <span className="small muted">{bg.dim}%</span>
          </label>
          <label className="slider-row">
            <span>Panel blur</span>
            <input type="range" min={0} max={40} value={bg.blur} onChange={(e) => set({ blur: Number(e.target.value) })} />
            <span className="small muted">{bg.blur}px</span>
          </label>
        </>
      )}
    </section>
  );
}

function CustomCssSection() {
  const css = useSettings((s) => s.customCss);
  const me = sessionStore.use((s) => s.me)!;
  const [code, setCode] = useState(css.code);
  const [tutorial, setTutorial] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cleaned = sanitizeCss(code);
  const removed = cleaned !== code.slice(0, CSS_LIMIT);
  const save = (next: string, enabled = css.enabled) => updateSettings({ customCss: { enabled, code: next.slice(0, CSS_LIMIT) } });
  return (
    <section className="settings-section">
      <h3>Custom CSS</h3>
      <p className="muted small">
        Change how Venband looks with your own CSS. It only affects your devices. Outside links, @import and scripts are removed. If something breaks, press{' '}
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> or open venband.com/?safe=1 for safe mode.
      </p>
      <div className="row-start wrap">
        <button className="btn secondary small" onClick={() => setTutorial(true)}>
          <Icon name="play" size={14} /> Watch the tutorial
        </button>
        <label className="btn secondary small">
          <Icon name="upload" size={14} /> Upload a .css file
          <input
            type="file"
            hidden
            accept=".css,text/css"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > CSS_LIMIT * 2) return setMsg({ ok: false, text: 'That file is too big (16 KB max).' });
              const text = await f.text();
              setCode(text);
              save(text, true);
              setMsg({ ok: true, text: `Loaded ${f.name}.` });
            }}
          />
        </label>
        <button
          className="btn link small"
          disabled={!code.trim()}
          onClick={async () => {
            const name = await askText({ title: 'Publish your CSS', label: 'Name it', maxLength: 40 });
            if (!name?.trim()) return;
            const { error } = await supabase.from('themes').insert({ author_id: me.id, name: name.trim(), description: '', data: { css: cleaned }, kind: 'css' });
            setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: 'Published to the Marketplace.' });
          }}
        >
          Publish to the Marketplace
        </button>
      </div>
      {msg && <div className={msg.ok ? 'form-notice' : 'form-error'}>{msg.text}</div>}
      <Toggle label="Use my custom CSS" checked={css.enabled} onChange={(v) => save(code, v)} />
      <textarea
        className="css-editor"
        spellCheck={false}
        rows={10}
        maxLength={CSS_LIMIT}
        value={code}
        placeholder={'.message-text {\n  font-size: 16px;\n}'}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => save(code)}
        aria-label="Custom CSS"
      />
      <div className="row-between small">
        <span className="muted">
          {code.length.toLocaleString()} / {CSS_LIMIT.toLocaleString()}
          {removed && ' · some unsafe parts will be skipped'}
        </span>
        <button className="btn primary small" onClick={() => (save(code, true), setMsg({ ok: true, text: 'Applied.' }))}>
          Apply
        </button>
      </div>
      <h4>Templates</h4>
      <div className="css-templates">
        {CSS_TEMPLATES.map((t) => (
          <button
            key={t.id}
            className="css-template"
            onClick={() => {
              const next = `${code.trim() ? `${code.trim()}\n\n` : ''}/* ${t.name} */\n${t.css}\n`;
              setCode(next);
              save(next, true);
            }}
          >
            <b>{t.name}</b>
            <span className="small muted">{t.desc}</span>
          </button>
        ))}
      </div>
      {tutorial && <CssTutorial onClose={() => setTutorial(false)} />}
    </section>
  );
}

const STEPS: { title: string; body: string; code: string; demo: string }[] = [
  { title: '1. Pick what to change', body: 'Every part of Venband has a class name. Messages are .message-text, channels are .channel, buttons are .btn.', code: '.message-text', demo: 'pick' },
  { title: '2. Change a colour', body: 'Inside the braces, set properties. Colours can be names, #hex codes or the theme variables like var(--accent).', code: '.message-text {\n  color: #7cf;\n}', demo: 'color' },
  { title: '3. Change the size', body: 'font-size makes text bigger or smaller. Try 16px or 18px.', code: '.message-text {\n  color: #7cf;\n  font-size: 18px;\n}', demo: 'size' },
  { title: '4. Round the corners', body: 'border-radius rounds corners; background gives things a fill. Together they make chat bubbles.', code: '.message-text {\n  background: #1d2b3a;\n  border-radius: 14px;\n  padding: 6px 10px;\n}', demo: 'bubble' },
  { title: '5. Apply and share', body: 'Press Apply to see it right away. Happy with it? Publish it to the Marketplace so others can use it. Stuck? Safe mode turns it off.', code: '/* Ctrl+Shift+Alt+S = safe mode */', demo: 'share' },
];

/** A short animated walkthrough that plays like a video. */
function CssTutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [typed, setTyped] = useState('');
  const timer = useRef<number | null>(null);
  const s = STEPS[step];
  useEffect(() => {
    setTyped('');
    let i = 0;
    const t = window.setInterval(() => {
      i++;
      setTyped(s.code.slice(0, i));
      if (i >= s.code.length) window.clearInterval(t);
    }, 28);
    return () => window.clearInterval(t);
  }, [step, s.code]);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => (step < STEPS.length - 1 ? setStep(step + 1) : setPlaying(false)), 5200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [step, playing]);
  return (
    <div className="css-tutorial" role="dialog" aria-label="Custom CSS tutorial">
      <div className="css-tutorial-screen">
        <div className="css-tut-code">
          <pre>{typed}<span className="caret" /></pre>
        </div>
        <div className={`css-tut-demo demo-${s.demo}`}>
          <div className="demo-msg">
            <span className="demo-av" />
            <div>
              <b>Alex</b>
              <div className="demo-text">This message changes as you type ✨</div>
            </div>
          </div>
        </div>
      </div>
      <div className="css-tutorial-caption">
        <b>{s.title}</b>
        <p className="small">{s.body}</p>
      </div>
      <div className="css-tutorial-bar">
        <button className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <div className="css-tut-progress">
          {STEPS.map((_, i) => (
            <button key={i} className={`seg${i < step ? ' done' : i === step ? ` now${playing ? ' playing' : ''}` : ''}`} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`} />
          ))}
        </div>
        <button className="btn secondary small" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
