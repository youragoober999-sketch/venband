import type { ReactNode } from 'react';
import { Icon, LogoGlyph, Wordmark } from './ui';
import { go } from '../lib/router';

const REPO_URL = 'https://github.com/youragoober999-sketch/venband';

export function TopNav({ onLogin, onSignup, onHome, onOpenApp }: { onLogin: () => void; onSignup: () => void; onHome: () => void; onOpenApp?: () => void }) {
  return (
    <header className="topnav">
      <div className="container topnav-inner">
        <button className="topnav-brand" onClick={onHome}>
          <Wordmark />
        </button>
        <nav className="topnav-links" aria-label="Site">
          <a href="#features" onClick={onHome}>
            Features
          </a>
          <a href="#privacy" onClick={onHome}>
            Privacy
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
        </nav>
        <div className="topnav-actions">
          <button className="btn ghost small" onClick={() => go('download')}>
            Download
          </button>
          {onOpenApp ? (
            <button className="btn primary small" onClick={onOpenApp}>
              Open Venband
            </button>
          ) : (
            <>
              <button className="btn ghost small" onClick={onLogin}>
                Log in
              </button>
              <button className="btn primary small" onClick={onSignup}>
                Sign up
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Landing({ onLogin, onSignup, onOpenApp }: { onLogin: () => void; onSignup: () => void; onOpenApp?: () => void }) {
  return (
    <div className="landing">
      <TopNav onLogin={onLogin} onSignup={onSignup} onHome={() => {}} onOpenApp={onOpenApp} />

      <section className="hero container">
        <div className="hero-copy">
          <p className="hero-chip">
            <span className="chip-dot" /> Free &amp; open source · runs in your browser
          </p>
          <h1>
            Talk with your people.
            <br />
            Nobody else listening.
          </h1>
          <p className="lead">
            Servers, channels, DMs and voice calls in one place. Every message is encrypted on your device before it’s
            sent, so the server only ever stores scrambled text.
          </p>
          <div className="hero-actions">
            {onOpenApp ? (
              <button className="btn primary big" onClick={onOpenApp}>
                Open Venband
              </button>
            ) : (
              <>
                <button className="btn primary big" onClick={onSignup}>
                  Create your account
                </button>
                <button className="btn text big" onClick={onLogin}>
                  I already have one →
                </button>
              </>
            )}
          </div>
        </div>
        <div className="hero-shot">
          <AppMockup />
        </div>
        <div className="facts">
          <Fact label="Works in">Chrome, Edge, Firefox, Safari</Fact>
          <Fact label="Encryption">On for every message</Fact>
          <Fact label="Calls">Voice, video, screen share</Fact>
          <Fact label="Price">Free, MIT licensed</Fact>
        </div>
      </section>

      <section className="features container" id="features">
        <h2>All the good parts of a group chat, none of the snooping.</h2>
        <div className="feature-grid">
          <Feature icon="users" title="Servers that fit your group">
            Text and voice channels in categories, roles with a dozen permissions, private channels, invite links that
            expire, kicks and bans.
          </Feature>
          <Feature icon="phone" title="Calls without the setup">
            Voice, video and screen sharing straight from the browser, connected directly between people. DM calls ring
            the other person.
          </Feature>
          <Feature icon="lock" title="Private by default">
            Messages and files are locked on your device. Kick someone and the channel gets a new key, so they can’t read
            what comes next.
          </Feature>
        </div>
      </section>

      <section className="privacy container" id="privacy">
        <h2>What stays private, and what doesn’t</h2>
        <p className="lead narrow">We’d rather be honest about it than make it sound magic.</p>
        <div className="privacy-rows">
          <PrivacyRow label="Your password">Never sent anywhere. Your device turns it into a login key and a separate key that unlocks your messages.</PrivacyRow>
          <PrivacyRow label="Messages & files">Encrypted before they leave your device, with a key only the people in that channel have.</PrivacyRow>
          <PrivacyRow label="Calls">Go straight between participants, encrypted, and signed so nobody can sneak into the middle.</PrivacyRow>
          <PrivacyRow label="What the server sees" muted>
            Who is in which server, server and channel names, usernames, and when messages were sent. Not what they say.
          </PrivacyRow>
        </div>
      </section>

      <section className="cta">
        <div className="container cta-inner">
          <div>
            <h2>Ready when your friends are.</h2>
            <p className="lead">Make a server, send one invite link, and you’re talking.</p>
          </div>
          <button className="btn primary big" onClick={onOpenApp ?? onSignup}>
            {onOpenApp ? 'Open Venband' : 'Get started — it’s free'}
          </button>
        </div>
      </section>

      <footer className="footer container">
        <span className="footer-brand">
          <LogoGlyph size={18} /> Venband
        </span>
        <span className="muted">Open source under the MIT license. Not affiliated with any other chat app.</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="mono-label">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="feature">
      <span className="feature-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function PrivacyRow({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className={`privacy-row${muted ? ' muted-row' : ''}`}>
      <span className="mono-label">{label}</span>
      <p>{children}</p>
    </div>
  );
}

const MOCK_MESSAGES = [
  { name: 'Rowan', color: '#e8618c', time: '9:02', text: 'ok who’s actually coming saturday' },
  { name: 'Ade', color: '#3fb6c6', time: '9:04', text: 'me!! I’ll bring the speaker' },
  { name: 'Priya', color: '#9b7bf0', time: '9:05', text: 'putting the address in #plans so it doesn’t get buried' },
];

function AppMockup() {
  return (
    <div className="mockup" aria-hidden>
      <div className="mockup-bar">
        <span className="dot red" />
        <span className="dot yellow" />
        <span className="dot green" />
        <span className="mockup-title">Venband</span>
      </div>
      <div className="mockup-body">
        <div className="mockup-rail">
          <span className="mockup-home">
            <LogoGlyph size={16} />
          </span>
          <span className="mockup-server active">WK</span>
          <span className="mockup-server">B4</span>
        </div>
        <div className="mockup-side">
          <div className="mockup-server-name">Weekend Crew</div>
          <div className="mockup-cat">Text channels</div>
          <div className="mockup-ch"># announcements</div>
          <div className="mockup-ch active"># general</div>
          <div className="mockup-ch"># plans</div>
          <div className="mockup-cat">Voice channels</div>
          <div className="mockup-ch">
            <Icon name="speaker" size={13} /> Hangout <span className="mockup-count">2</span>
          </div>
        </div>
        <div className="mockup-chat">
          <div className="mockup-head">
            # general <Icon name="lock" size={11} />
          </div>
          <div className="mockup-msgs">
            {MOCK_MESSAGES.map((m) => (
              <div className="mockup-msg" key={m.name}>
                <span className="mockup-av" style={{ background: m.color }}>
                  {m.name[0]}
                </span>
                <div>
                  <b>{m.name}</b> <small>{m.time}</small>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mockup-input">+ &nbsp;Message #general</div>
        </div>
        <div className="mockup-members">
          <div className="mockup-cat">Online — 3</div>
          {MOCK_MESSAGES.map((m) => (
            <div className="mockup-member" key={m.name}>
              <span className="mockup-av small" style={{ background: m.color }}>
                {m.name[0]}
              </span>
              {m.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
