import { Link } from 'react-router-dom';

const URL_RE = /(https?:\/\/[^\s<]+)/g;

/**
 * Message text with web links made clickable. Links to this site open inside the app; other links open in a new tab
 * with `noopener`. Only http and https are turned into links, and everything is rendered as React text (never as HTML).
 */
export function Linkify({ text }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        let url;
        try { url = new URL(part); } catch { return part; }
        if (!['http:', 'https:'].includes(url.protocol)) return part;
        return url.origin === location.origin
          ? <Link key={i} to={url.pathname + url.search} className="msg-link">{part}</Link>
          : <a key={i} href={url.href} target="_blank" rel="noopener noreferrer nofollow" className="msg-link">{part}</a>;
      })}
    </>
  );
}
