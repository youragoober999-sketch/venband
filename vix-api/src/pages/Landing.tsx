import { A, Icon, Logo } from '../components/ui'
import { t } from '../lib/i18n'
import { LANGUAGES } from '../../shared/languages.js'

const FEATURES = [
  { icon: 'bolt', title: 'Always online', text: 'Endpoints run on serverless infrastructure, so your APIs answer 24/7 - even when you close the site.' },
  { icon: 'terminal', title: 'Built-in sandbox', text: 'Run JavaScript, Python, Rust, Batch, Java, C# and 50+ more languages without installing anything.' },
  { icon: 'key', title: 'API keys', text: 'Create keys per app or per game, limit them to one API, roll or revoke them in one click.' },
  { icon: 'users', title: 'Friends & teams', text: 'Add friends by username and share APIs with them as editors or viewers.' },
  { icon: 'bot', title: 'AI ready', text: 'Every API gets an OpenAPI spec and an MCP server, so ChatGPT, Claude and agents can call it as tools.' },
  { icon: 'gamepad', title: 'Game engines', text: 'Copy-paste guides for Unity, Unreal, Godot, Roblox, GameMaker, Defold, Bevy, Minecraft and more.' },
  { icon: 'puzzle', title: 'Extensions', text: 'Rate limits, caching, KV storage, secrets, webhooks, scheduled jobs, Vim keys, rainbow brackets and more.' },
  { icon: 'history', title: 'Never lose work', text: 'Auto-save, version snapshots with one-click restore, and .zip export/import of whole projects.' },
  { icon: 'eye', title: 'Accessible by design', text: 'Screen reader support, full keyboard control, high contrast themes, dyslexia-friendly fonts, text scaling and 12 UI languages.' },
]

export function Landing() {
  const runnable = LANGUAGES.filter((l) => l.runner !== 'none')
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="brand"><Logo size={32} /><span>Vix Api</span></span>
        <nav aria-label="Account">
          <A href="/docs" className="btn btn-ghost btn-md">{t('nav.docs')}</A>
          <A href="/login" className="btn btn-ghost btn-md">{t('auth.signin')}</A>
          <A href="/signup" className="btn btn-primary btn-md">{t('auth.signup')}</A>
        </nav>
      </header>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-glow" aria-hidden="true" />
        <h1 id="hero-title">{t('landing.tagline')}</h1>
        <p className="hero-sub">{t('landing.sub')}</p>
        <div className="hero-cta">
          <A href="/signup" className="btn btn-primary btn-lg"><Icon name="zap" />{t('landing.start')}</A>
          <A href="/login" className="btn btn-secondary btn-lg">{t('landing.signin')}</A>
        </div>
        <p className="hint">{t('auth.noEmail')}</p>
        <div className="hero-code" aria-label="Example endpoint code">
          <div className="hero-code-bar" aria-hidden="true"><span /><span /><span /> <em>leaderboard.js</em></div>
          <pre><code>{`async function handler(req) {
  const scores = (await vix.kv.get('scores')) || []
  if (req.method === 'POST') {
    scores.push(req.body)
    await vix.kv.set('scores', scores)
  }
  return { top: scores.sort((a, b) => b.score - a.score).slice(0, 10) }
}`}</code></pre>
          <div className="hero-curl"><span aria-hidden="true">$</span> curl -H "x-api-key: vix_…" https://your-site/v1/you/game/scores</div>
        </div>
      </section>
      <section className="features" aria-labelledby="feat-title">
        <h2 id="feat-title" className="sr-only">Features</h2>
        <ul className="feature-grid">
          {FEATURES.map((f) => (
            <li key={f.title} className="feature">
              <span className="feature-icon"><Icon name={f.icon} size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="lang-cloud" aria-labelledby="lang-title">
        <h2 id="lang-title">{runnable.length} languages and file types</h2>
        <ul>
          {runnable.map((l) => <li key={l.id}>{l.name}</li>)}
        </ul>
      </section>
      <footer className="landing-foot">
        <span>Vix Api</span>
        <A href="/docs">{t('nav.docs')}</A>
      </footer>
    </div>
  )
}
