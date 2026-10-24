import { Link } from 'react-router-dom';

// #tags use letters, numbers and underscores (the same rule the server uses); @mentions may also contain dots.
const TOKEN = /([#@])([\p{L}\p{N}_.]{1,50})/gu;
const WORD = /[\p{L}\p{N}_&]/u;

/** Caption text with #hashtags and @mentions turned into links. Built from React nodes, so nothing user-typed is ever injected as HTML. */
export function Caption({ text, className }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    // "me#1" or "a@b.com" are not tags or mentions: the sign must start a word.
    if (start > 0 && WORD.test(text[start - 1])) continue;
    const sign = m[1];
    let word = m[2];
    if (sign === '#')
      word = word.replace(/\..*$/, ''); // hashtags stop at a dot, like on the server
    else word = word.replace(/\.+$/, ''); // a trailing full stop belongs to the sentence
    if (!word || (sign === '@' && word.length < 3)) continue;
    parts.push(text.slice(last, start));
    const to = sign === '#' ? `/tag/${encodeURIComponent(word.toLowerCase())}` : `/u/${encodeURIComponent(word.toLowerCase())}`;
    parts.push(
      <Link key={start} to={to} className="tag-link">
        {sign}
        {word}
      </Link>,
    );
    last = start + 1 + word.length;
  }
  parts.push(text.slice(last));
  return <p className={className}>{parts}</p>;
}
