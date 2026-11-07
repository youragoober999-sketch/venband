// Searchable legal pages: /tos, /privacy, /privacy/connections and
// /policy/consumer-use. The words live in lib/legal.ts.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { go } from '../lib/router';
import { blockText, LEGAL_DOCS, legalDoc, type LegalBlock, type LegalDoc, type LegalSection } from '../lib/legal';
import { PublicLayout } from './PublicPages';
import { Icon } from './ui';
import './legal.css';

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);

const sectionText = (s: LegalSection) => `${s.title}\n${s.body.map(blockText).join('\n')}`.toLowerCase();
const matches = (s: LegalSection, ws: string[]) => {
  if (!ws.length) return true;
  const t = sectionText(s);
  return ws.every((w) => t.includes(w));
};
/** Go to another legal page without carrying this page's #section along. */
function nav(path: string, query = '') {
  history.replaceState(null, '', window.location.pathname + query);
  go(path.replace(/^\/+/, ''), { keepQuery: Boolean(query) });
  window.scrollTo(0, 0);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text with search words wrapped in <mark>. */
function Hl({ text, ws }: { text: string; ws: string[] }) {
  if (!ws.length) return <>{text}</>;
  const re = new RegExp(`(${ws.map(escapeRe).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

/** A paragraph string: [label](/path) links plus highlighting. */
function Rich({ text, ws }: { text: string; ws: string[] }) {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Hl key={`t${last}`} text={text.slice(last, m.index)} ws={ws} />);
    const href = m[2];
    out.push(
      <a
        key={`a${m.index}`}
        href={href}
        onClick={(e) => {
          if (!href.startsWith('/')) return;
          e.preventDefault();
          nav(href);
        }}
      >
        <Hl text={m[1]} ws={ws} />
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Hl key={`t${last}`} text={text.slice(last)} ws={ws} />);
  return <>{out}</>;
}

function Block({ b, ws }: { b: LegalBlock; ws: string[] }) {
  if (typeof b === 'string')
    return (
      <p>
        <Rich text={b} ws={ws} />
      </p>
    );
  if (b[0] === 'h')
    return (
      <h3>
        <Hl text={b[1]} ws={ws} />
      </h3>
    );
  return (
    <ul>
      {b[1].map((li, i) => (
        <li key={i}>
          <Rich text={li} ws={ws} />
        </li>
      ))}
    </ul>
  );
}

const TABS: { key: string; label: string; path: string }[] = [
  ...LEGAL_DOCS.map((d) => ({ key: d.key, label: d.short, path: d.path })),
  { key: 'guidelines', label: 'Guidelines', path: 'guidelines' },
];

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const [q, setQ] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('q') ?? '';
    } catch {
      return '';
    }
  });
  const [active, setActive] = useState<string>(doc.sections[0]?.id ?? '');
  const input = useRef<HTMLInputElement>(null);
  const ws = useMemo(() => words(q), [q]);
  const numbered = useMemo(() => doc.sections.map((s, i) => ({ s, n: i + 1 })), [doc]);
  const shown = numbered.filter(({ s }) => matches(s, ws));
  const elsewhere = useMemo(
    () => (ws.length ? LEGAL_DOCS.filter((d) => d.key !== doc.key).map((d) => ({ d, n: d.sections.filter((s) => matches(s, ws)).length })).filter((x) => x.n > 0) : []),
    [ws, doc.key],
  );

  // land on #section links (old links like /tos#gifs keep working)
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }, [doc.key]);

  // "/" jumps to search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // highlight the section being read in the contents
  useEffect(() => {
    const els = shown.map(({ s }) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown.length, doc.key, q]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <PublicLayout page={doc.key === 'tos' ? 'tos' : doc.key === 'privacy' || doc.key === 'connections' ? 'privacy' : 'policy'} title={doc.title} wide>
      <div className="lg">
        <header className="lg-hero">
          <span className="lg-eyebrow">
            <Icon name="shield" size={14} /> Venband Legal
          </span>
          <h1>{doc.title}</h1>
          <div className="lg-dates">
            <span>
              Effective <b>{doc.effective}</b>
            </span>
            <span>
              Last updated <b>{doc.updated}</b>
            </span>
          </div>
          <nav className="lg-tabs" aria-label="Policies">
            {TABS.map((t) => (
              <a
                key={t.key}
                href={`/${t.path}`}
                className={t.key === doc.key ? 'on' : ''}
                aria-current={t.key === doc.key ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  nav(t.path);
                }}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        <div className="lg-search">
          <Icon name="search" size={18} />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search the ${doc.title}…`}
            aria-label={`Search the ${doc.title}`}
          />
          {q ? (
            <button className="lg-clear" onClick={() => setQ('')} aria-label="Clear search">
              <Icon name="x" size={14} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        {ws.length > 0 && (
          <div className="lg-results">
            {shown.length ? `${shown.length} of ${doc.sections.length} sections match` : 'No sections match'} “{q.trim()}”
            {elsewhere.map(({ d, n }) => (
              <a
                key={d.key}
                href={`/${d.path}?q=${encodeURIComponent(q)}`}
                onClick={(e) => {
                  e.preventDefault();
                  nav(d.path, `?q=${encodeURIComponent(q)}`);
                }}
              >
                {n} in {d.short}
              </a>
            ))}
          </div>
        )}

        <div className="lg-grid">
          <aside className="lg-toc" aria-label="Contents">
            <div className="lg-toc-title">Contents</div>
            <ol>
              {shown.map(({ s, n }) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={active === s.id ? 'on' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      jump(s.id);
                    }}
                  >
                    <span className="lg-n">{n}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </aside>

          <article className="lg-doc">
            {ws.length === 0 &&
              doc.intro.map((p, i) => (
                <p key={i} className="lg-intro">
                  <Rich text={p} ws={[]} />
                </p>
              ))}
            {shown.length === 0 && (
              <div className="lg-empty">
                <Icon name="search" size={28} />
                <b>Nothing here matches “{q.trim()}”.</b>
                <span>Try fewer or different words{elsewhere.length ? ', or check the other policies above' : ''}.</span>
              </div>
            )}
            {shown.map(({ s, n }) => (
              <section key={s.id} id={s.id} className="lg-section">
                <h2>
                  <span className="lg-num">{n}</span>
                  <Hl text={s.title} ws={ws} />
                  <a
                    className="lg-anchor"
                    href={`#${s.id}`}
                    aria-label={`Link to ${s.title}`}
                    onClick={(e) => {
                      e.preventDefault();
                      jump(s.id);
                      void navigator.clipboard?.writeText(`${window.location.origin}/${doc.path}#${s.id}`).catch(() => {});
                    }}
                  >
                    #
                  </a>
                </h2>
                {s.body.map((b, i) => (
                  <Block key={i} b={b} ws={ws} />
                ))}
              </section>
            ))}
          </article>
        </div>
      </div>
    </PublicLayout>
  );
}

export const TermsPage = () => <LegalPage doc={legalDoc('tos')} />;
export const PrivacyPage = () => <LegalPage doc={legalDoc('privacy')} />;
export const ConnectionsPolicyPage = () => <LegalPage doc={legalDoc('connections')} />;
export const ConsumerUsePage = () => <LegalPage doc={legalDoc('consumer-use')} />;
