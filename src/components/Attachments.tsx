import { useEffect, useMemo, useRef, useState } from 'react';
import { isRiskyFile } from '../lib/metadata';
import { askConfirm } from './Dialogs';
import type { Attachment } from '../lib/crypto';
import { CODE_LANGS, downloadDecrypted, extOf, fileIcon, fileKind, saveDecrypted } from '../lib/files';
import { highlight, LANGUAGE_OPTIONS } from '../lib/highlight';
import { errorMessage } from '../lib/supabase';
import { copyText, openMenu } from './ContextMenu';
import { Icon, Modal } from './ui';
import { Select } from './Select';

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const AUTO_LOAD = { image: 25, video: 60, audio: 40, pdf: 0, code: 2, other: 0 } as const; // MB

/** Decrypts an attachment on demand and hands back a blob URL. */
function useDecrypted(a: Attachment, auto: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  async function load() {
    if (started.current) return;
    started.current = true;
    setProgress(0);
    try {
      const b = await downloadDecrypted(a, setProgress);
      setBlob(b);
      setUrl(URL.createObjectURL(b));
    } catch (e) {
      setError(errorMessage(e));
      started.current = false;
    } finally {
      setProgress(null);
    }
  }
  useEffect(() => {
    if (auto) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.path]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { url, blob, progress, error, load };
}

function DownloadButton({ a, small }: { a: Attachment; small?: boolean }) {
  const [p, setP] = useState<number | null>(null);
  return (
    <button
      className={`icon-btn${small ? ' small' : ''}`}
      title={p !== null ? `Downloading ${Math.round(p * 100)}%` : `Download (${formatSize(a.size)})`}
      onClick={async (e) => {
        e.stopPropagation();
        if (
          isRiskyFile(a.name) &&
          !(await askConfirm({
            title: 'This file could harm your computer',
            body: `“${a.name}” is a kind of file that can run programs. Only open it if you trust the person who sent it and expected it.`,
            confirm: 'Download anyway',
            danger: true,
          }))
        )
          return;
        setP(0);
        try {
          await saveDecrypted(a, setP);
        } catch (err) {
          if ((err as Error)?.name !== 'AbortError') alert(errorMessage(err));
        } finally {
          setP(null);
        }
      }}
    >
      {p !== null ? <span className="dl-pct">{Math.round(p * 100)}%</span> : <Icon name="download" size={18} />}
    </button>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="att-progress">
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function FileCard({ a, children, onOpen }: { a: Attachment; children?: React.ReactNode; onOpen?: () => void }) {
  return (
    <div className="attachment" onClick={onOpen} role={onOpen ? 'button' : undefined}>
      <span className="att-icon">{fileIcon(a.name)}</span>
      <div className="grow att-text">
        <div className="attachment-name" title={a.name}>
          {a.name}
        </div>
        <div className="small muted">
          {formatSize(a.size)} · encrypted{extOf(a.name) ? ` · .${extOf(a.name)}` : ''}
        </div>
        {children}
      </div>
      <DownloadButton a={a} />
    </div>
  );
}

export function AttachmentView({ a }: { a: Attachment }) {
  const [revealed, setRevealed] = useState(!a.spoiler);
  if (!revealed)
    return (
      <button type="button" className="spoiler-file" onClick={() => setRevealed(true)} aria-label={`Spoiler: ${a.name}. Click to reveal.`}>
        <span className="spoiler-file-blur" aria-hidden>
          <span className="att-icon">{fileIcon(a.name)}</span>
          <span className="attachment-name">{a.name}</span>
        </span>
        <span className="spoiler-file-label">
          <Icon name="eyeOff" size={16} /> SPOILER
        </span>
      </button>
    );
  return <AttachmentInner a={a} />;
}

function AttachmentInner({ a }: { a: Attachment }) {
  const kind = fileKind(a);
  const auto = a.size <= AUTO_LOAD[kind] * 1024 * 1024;
  if (kind === 'image') return <ImageAttachment a={a} auto={auto} />;
  if (kind === 'video') return <MediaAttachment a={a} auto={auto} video />;
  if (kind === 'audio') return <MediaAttachment a={a} auto={auto} />;
  if (kind === 'pdf') return <PdfAttachment a={a} />;
  if (kind === 'code') return <CodeAttachment a={a} />;
  return <FileCard a={a} />;
}

function ImageAttachment({ a, auto }: { a: Attachment; auto: boolean }) {
  const { url, progress, error, load } = useDecrypted(a, auto);
  const [big, setBig] = useState(false);
  const [broken, setBroken] = useState(false);
  if (error || broken) return <FileCard a={a}>{error && <div className="small danger-text">{error}</div>}</FileCard>;
  if (!url)
    return (
      <FileCard a={a} onOpen={load}>
        {progress !== null ? <Progress value={progress} /> : <button className="btn link small">Show picture</button>}
      </FileCard>
    );
  return (
    <>
      <img className="attachment-img" src={url} alt={a.alt || a.name} title={a.alt || undefined} onClick={() => setBig(true)} onError={() => setBroken(true)} />
      {big && (
        <div className="lightbox" onClick={() => setBig(false)}>
          <img src={url} alt={a.name} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span>{a.name}</span>
            <DownloadButton a={a} />
            <button className="icon-btn" onClick={() => setBig(false)} title="Close">
              <Icon name="x" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function MediaAttachment({ a, auto, video }: { a: Attachment; auto: boolean; video?: boolean }) {
  const { url, progress, error, load } = useDecrypted(a, auto);
  const [unplayable, setUnplayable] = useState(false);
  if (error) return <FileCard a={a}><div className="small danger-text">{error}</div></FileCard>;
  if (unplayable)
    return (
      <FileCard a={a}>
        <div className="small muted">Your browser can’t play this format. Download it to watch.</div>
      </FileCard>
    );
  if (!url)
    return (
      <div className={`media-card ${video ? 'video' : 'audio'}`}>
        <button className="media-play" onClick={load} disabled={progress !== null} title="Play">
          <Icon name="play" size={video ? 30 : 20} />
        </button>
        <div className="grow att-text">
          <div className="attachment-name">{a.name}</div>
          <div className="small muted">{progress !== null ? `Decrypting… ${Math.round(progress * 100)}%` : `${formatSize(a.size)} · click to ${video ? 'watch' : 'listen'}`}</div>
          {progress !== null && <Progress value={progress} />}
        </div>
        <DownloadButton a={a} />
      </div>
    );
  return video ? (
    <div className="video-wrap">
      <video className="attachment-video" src={url} controls playsInline preload="metadata" onError={() => setUnplayable(true)} />
      <div className="video-bar">
        <span className="attachment-name">{a.name}</span>
        <span className="small muted">{formatSize(a.size)}</span>
        <DownloadButton a={a} small />
      </div>
    </div>
  ) : (
    <div className="audio-card">
      <span className="att-icon">🎵</span>
      <div className="grow att-text">
        <div className="attachment-name">{a.name}</div>
        <audio src={url} controls preload="metadata" onError={() => setUnplayable(true)} />
      </div>
      <DownloadButton a={a} />
    </div>
  );
}

function PdfAttachment({ a }: { a: Attachment }) {
  const { url, progress, error, load } = useDecrypted(a, false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <FileCard a={a}>
        {error ? (
          <div className="small danger-text">{error}</div>
        ) : progress !== null ? (
          <Progress value={progress} />
        ) : (
          <button className="btn link small" onClick={(e) => (e.stopPropagation(), load().then(() => setOpen(true)))}>
            View PDF
          </button>
        )}
      </FileCard>
      {open && url && (
        <Modal title={a.name} onClose={() => setOpen(false)} wide>
          <iframe className="pdf-frame" src={url} title={a.name} />
        </Modal>
      )}
    </>
  );
}

const PREVIEW_LINES = 12;
const MAX_VIEW = 2 * 1024 * 1024;

function CodeAttachment({ a }: { a: Attachment }) {
  const auto = a.size <= MAX_VIEW;
  const { blob, progress, error, load } = useDecrypted(a, auto);
  const [text, setText] = useState<string | null>(null);
  const [lang, setLang] = useState(CODE_LANGS[extOf(a.name)] ?? 'plaintext');
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (blob) blob.slice(0, MAX_VIEW).text().then(setText);
  }, [blob]);
  const lines = useMemo(() => (text ?? '').split('\n'), [text]);
  const preview = lines.slice(0, PREVIEW_LINES).join('\n');
  const html = useMemo(() => (text === null ? '' : highlight(preview, lang)), [preview, lang, text]);

  if (error) return <FileCard a={a}><div className="small danger-text">{error}</div></FileCard>;
  if (text === null)
    return (
      <FileCard a={a} onOpen={a.size <= 50 * MAX_VIEW ? load : undefined}>
        {progress !== null ? <Progress value={progress} /> : !auto && <button className="btn link small">Preview first 2 MB</button>}
      </FileCard>
    );
  return (
    <div className="code-card">
      <div className="code-head">
        <span className="att-icon small">{'</>'}</span>
        <div className="grow att-text">
          <div className="attachment-name">{a.name}</div>
          <div className="small muted">
            {formatSize(a.size)} · {lines.length.toLocaleString()} lines{a.size > MAX_VIEW ? ' (first 2 MB shown)' : ''}
          </div>
        </div>
        <Select className="code-lang" value={lang} onChange={setLang} title="Language" searchable options={LANGUAGE_OPTIONS.map((l) => ({ value: l.id, label: l.label }))} />
        <button className="icon-btn" title="Copy" onClick={() => copyText(text)}>
          <Icon name="copy" size={16} />
        </button>
        <DownloadButton a={a} />
      </div>
      <pre className="code-body hljs">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {lines.length > PREVIEW_LINES ? (
        <button className="code-expand" onClick={() => setFull(true)}>
          View whole file ({lines.length.toLocaleString()} lines)
        </button>
      ) : (
        <button className="code-expand" onClick={() => setFull(true)}>
          Open viewer
        </button>
      )}
      {full && <CodeViewer name={a.name} text={text} lang={lang} setLang={setLang} a={a} onClose={() => setFull(false)} />}
    </div>
  );
}

function CodeViewer({ name, text, lang, setLang, a, onClose }: { name: string; text: string; lang: string; setLang: (l: string) => void; a: Attachment; onClose: () => void }) {
  const html = useMemo(() => highlight(text, lang), [text, lang]);
  const count = useMemo(() => text.split('\n').length, [text]);
  return (
    <Modal
      title={
        <span className="viewer-title">
          {name}
          <Select className="code-lang" value={lang} onChange={setLang} title="Language" searchable options={LANGUAGE_OPTIONS.map((l) => ({ value: l.id, label: l.label }))} />
          <button className="icon-btn" title="Copy everything" onClick={() => copyText(text)}>
            <Icon name="copy" size={16} />
          </button>
          <DownloadButton a={a} />
        </span>
      }
      onClose={onClose}
      wide
    >
      <div className="code-viewer" onContextMenu={(e) => openMenu(e, [{ label: 'Copy whole file', icon: 'copy', onClick: () => copyText(text) }])}>
        <div className="code-gutter" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className="hljs">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </Modal>
  );
}
