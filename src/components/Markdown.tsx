// Discord-style markdown, rendered safely (React elements only, never HTML).
//   # / ## / ### headings, -# subtext, > quotes, >>> quotes, - lists, 1. lists
//   **bold** *italic* _italic_ __underline__ ~~strike~~ ||spoiler|| `code` ```blocks```
//   [masked](https://links), <https://no-embed>, <@user> <@&role> <#channel> @everyone @here
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { highlightAuto, languageLabel } from '../lib/highlight';
import { useSettings } from '../lib/settings';

export interface MentionContext {
  userName: (id: string) => string | null;
  roleOf: (id: string) => { name: string; color: string } | null;
  channelName: (id: string) => string | null;
  isMe: (id: string) => boolean;
  myRoleIds?: string[];
  onUser?: (id: string, el: HTMLElement) => void;
  onChannel?: (id: string) => void;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const URL_RE = /https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?*_~|]/;

/** Does this message mention me (directly, by role, or @everyone/@here)? */
export function mentionsMe(text: string, myId: string, myRoleIds: string[] = [], allowEveryone = true): boolean {
  if (text.includes(`<@${myId}>`)) return true;
  if (myRoleIds.some((r) => text.includes(`<@&${r}>`))) return true;
  return allowEveryone && /(^|[^\w`])@(everyone|here)\b/.test(text);
}

/** A ``` block: coloured like a code editor, with the language and a copy button. */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { html, language } = useMemo(() => highlightAuto(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-codeblock-wrap">
      <div className="md-codeblock-bar">
        <span>{languageLabel(language)}</span>
        <button
          type="button"
          className="btn link small"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="md-codeblock hljs" data-lang={language}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

export function Markdown({ text, ctx }: { text: string; ctx?: MentionContext }) {
  const blocks: ReactNode[] = [];
  const pieces = text.split(/```/);
  pieces.forEach((piece, i) => {
    if (i % 2 === 1 && i < pieces.length - 1) {
      const m = piece.match(/^([\w+-]{1,20})\n/);
      const code = m ? piece.slice(m[0].length) : piece.replace(/^\n/, '');
      blocks.push(<CodeBlock key={`c${i}`} code={code.replace(/\n$/, '')} lang={m?.[1]} />);
      return;
    }
    const raw = i % 2 === 1 ? '```' + piece : piece;
    blocks.push(<Fragment key={`b${i}`}>{renderLines(raw, ctx, `b${i}`)}</Fragment>);
  });
  return <>{blocks}</>;
}

function renderLines(text: string, ctx: MentionContext | undefined, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join('\n');
    out.push(<span key={`${key}p${i}-${out.length}`} className="md-p">{inline(joined, ctx, `${key}p${out.length}`)}</span>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    // >>> quotes everything after it
    if (line.startsWith('>>> ')) {
      flush();
      const rest = [line.slice(4), ...lines.slice(i + 1)].join('\n');
      out.push(<blockquote key={`${key}q${i}`} className="md-quote">{renderLines(rest, ctx, `${key}qq`)}</blockquote>);
      return out;
    }
    if (/^> ?/.test(line) && line.startsWith('>')) {
      flush();
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>') && !lines[i].startsWith('>>> ')) {
        q.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      out.push(<blockquote key={`${key}q${i}`} className="md-quote">{renderLines(q.join('\n'), ctx, `${key}q${i}`)}</blockquote>);
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) {
      flush();
      const level = h[1].length;
      const Tag = (`h${level + 2}`) as 'h3' | 'h4' | 'h5';
      out.push(<Tag key={`${key}h${i}`} className={`md-h md-h${level}`}>{inline(h[2], ctx, `${key}h${i}`)}</Tag>);
      i++;
      continue;
    }
    const sub = line.match(/^-# (.+)$/);
    if (sub) {
      flush();
      out.push(<small key={`${key}s${i}`} className="md-sub">{inline(sub[1], ctx, `${key}s${i}`)}</small>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d{1,3}\.) /.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d{1,3}\.) /.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
        items.push(lines[i].replace(/^\s*([-*]|\d{1,3}\.) /, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      out.push(
        <ListTag key={`${key}l${i}`} className="md-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it, ctx, `${key}l${i}-${j}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

// earliest-match inline tokenizer
const INLINE: { name: string; re: RegExp }[] = [
  { name: 'code', re: /`([^`\n]+)`/ },
  { name: 'masked', re: /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/ },
  { name: 'angle', re: /<(https?:\/\/[^\s>]+)>/ },
  { name: 'user', re: new RegExp(`<@!?(${UUID})>`) },
  { name: 'role', re: new RegExp(`<@&(${UUID})>`) },
  { name: 'channel', re: new RegExp(`<#(${UUID})>`) },
  { name: 'everyone', re: /@(everyone|here)\b/ },
  { name: 'url', re: URL_RE },
  { name: 'spoiler', re: /\|\|([\s\S]+?)\|\|/ },
  { name: 'bolditalic', re: /\*\*\*([\s\S]+?)\*\*\*/ },
  { name: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { name: 'underline', re: /__([\s\S]+?)__/ },
  { name: 'italic', re: /\*([^*\s][\s\S]*?)\*|\b_([^_\s][\s\S]*?)_\b/ },
  { name: 'strike', re: /~~([\s\S]+?)~~/ },
];

function inline(text: string, ctx: MentionContext | undefined, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { name: string; m: RegExpExecArray } | null = null;
    for (const t of INLINE) {
      const m = t.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { name: t.name, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { name, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${n++}`;
    out.push(renderToken(name, m, ctx, k));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function renderToken(name: string, m: RegExpExecArray, ctx: MentionContext | undefined, k: string): ReactNode {
  switch (name) {
    case 'code':
      return <code key={k} className="md-code">{m[1]}</code>;
    case 'masked':
      return (
        <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" title={m[2]}>
          {inline(m[1], ctx, k)}
        </a>
      );
    case 'angle':
    case 'url': {
      const href = name === 'angle' ? m[1] : m[0];
      return (
        <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {href}
        </a>
      );
    }
    case 'user': {
      const label = ctx?.userName(m[1]);
      return (
        <span
          key={k}
          className={`mention${ctx?.isMe(m[1]) ? ' me' : ''}`}
          role="button"
          tabIndex={0}
          onClick={(e) => ctx?.onUser?.(m[1], e.currentTarget)}
        >
          @{label ?? 'unknown-user'}
        </span>
      );
    }
    case 'role': {
      const role = ctx?.roleOf(m[1]);
      return (
        <span key={k} className={`mention role${ctx?.myRoleIds?.includes(m[1]) ? ' me' : ''}`} style={role ? { color: role.color, background: `${role.color}22` } : undefined}>
          @{role?.name ?? 'deleted-role'}
        </span>
      );
    }
    case 'channel':
      return (
        <span key={k} className="mention" role="button" tabIndex={0} onClick={() => ctx?.onChannel?.(m[1])}>
          #{ctx?.channelName(m[1]) ?? 'unknown'}
        </span>
      );
    case 'everyone':
      return <span key={k} className="mention me">@{m[1]}</span>;
    case 'spoiler':
      return <Spoiler key={k}>{inline(m[1], ctx, k)}</Spoiler>;
    case 'bolditalic':
      return (
        <strong key={k}>
          <em>{inline(m[1], ctx, k)}</em>
        </strong>
      );
    case 'bold':
      return <strong key={k}>{inline(m[1], ctx, k)}</strong>;
    case 'underline':
      return <u key={k}>{inline(m[1], ctx, k)}</u>;
    case 'italic':
      return <em key={k}>{inline(m[1] ?? m[2], ctx, k)}</em>;
    case 'strike':
      return <s key={k}>{inline(m[1], ctx, k)}</s>;
  }
  return m[0];
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`md-spoiler${shown ? ' shown' : ''}`} onClick={() => setShown(true)} role="button" tabIndex={0} aria-label="Spoiler">
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- embeds --

export interface EmbedInfo {
  kind: 'youtube' | 'spotify' | 'instagram' | 'tiktok' | 'gif';
  url: string;
  src: string;
  label: string;
  tall?: boolean;
}

export function findEmbeds(text: string): EmbedInfo[] {
  // code and <suppressed> links never embed
  const scrubbed = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/<https?:\/\/[^\s>]+>/g, ' ');
  const urls = scrubbed.match(new RegExp(URL_RE.source, 'g')) ?? [];
  const out: EmbedInfo[] = [];
  for (const u of urls) {
    const e = embedFor(u);
    if (e && !out.some((x) => x.src === e.src)) out.push(e);
    if (out.length >= 4) break;
  }
  return out;
}

export function embedFor(raw: string): EmbedInfo | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const id =
      host === 'youtu.be'
        ? u.pathname.slice(1)
        : (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1] ?? '');
    if (!/^[\w-]{6,20}$/.test(id)) return null;
    const t = Number.parseInt(u.searchParams.get('t') ?? '', 10);
    return {
      kind: 'youtube',
      url: raw,
      src: `https://www.youtube-nocookie.com/embed/${id}${t ? `?start=${t}` : ''}`,
      label: 'YouTube',
      tall: u.pathname.startsWith('/shorts/'),
    };
  }
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,32})/);
    if (!m) return null;
    return { kind: 'spotify', url: raw, src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, label: 'Spotify' };
  }
  if (host === 'instagram.com') {
    const m = u.pathname.match(/^\/(p|reel|reels|tv)\/([\w-]{5,40})/);
    if (!m) return null;
    return { kind: 'instagram', url: raw, src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, label: 'Instagram', tall: true };
  }
  if (host === 'tiktok.com') {
    const m = u.pathname.match(/\/video\/(\d{8,25})/);
    if (!m) return null;
    return { kind: 'tiktok', url: raw, src: `https://www.tiktok.com/embed/v2/${m[1]}`, label: 'TikTok', tall: true };
  }
  if (/(^|\.)klipy\.com$/.test(u.hostname) && /\.(gif|webp|mp4|webm)$/i.test(u.pathname)) {
    return { kind: 'gif', url: raw, src: raw, label: 'GIF' };
  }
  return null;
}

/** A message that is nothing but a single GIF link shows just the GIF. */
export function isBareGif(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) && embedFor(t)?.kind === 'gif';
}

export function Embed({ e }: { e: EmbedInfo }) {
  const auto = useSettings((s) => s.chat.autoEmbeds);
  const autoplay = useSettings((s) => s.chat.gifAutoplay);
  const [loaded, setLoaded] = useState(false);
  if (e.kind === 'gif') {
    if (/\.(mp4|webm)$/i.test(e.src))
      return <video className="embed-gif" src={e.src} autoPlay={autoplay} loop muted playsInline controls={!autoplay} />;
    return <GifImage src={e.src} autoplay={autoplay} />;
  }
  if (!loaded && !auto) {
    return (
      <div className={`embed-card ${e.kind}`}>
        <div className="embed-provider">{e.label}</div>
        <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="embed-link">
          {e.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)}
        </a>
        <button className="btn small secondary" onClick={() => setLoaded(true)}>
          Load {e.label} embed
        </button>
        <span className="small muted">Loading it lets {e.label} see your IP address.</span>
      </div>
    );
  }
  return (
    <div className={`embed-frame ${e.kind}${e.tall ? ' tall' : ''}`}>
      <iframe
        src={e.src}
        title={`${e.label} embed`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}

function GifImage({ src, autoplay }: { src: string; autoplay: boolean }) {
  const [play, setPlay] = useState(autoplay);
  if (play) return <img className="embed-gif" src={src} alt="GIF" loading="lazy" onClick={() => !autoplay && setPlay(false)} />;
  return (
    <button className="embed-gif paused" onClick={() => setPlay(true)}>
      GIF · click to play
    </button>
  );
}
