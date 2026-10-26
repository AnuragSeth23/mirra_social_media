import { useEffect, useRef, useState } from 'react';
import { api, ApiError, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, uploadMedia } from '../lib/api';
import { CameraCapture } from './CameraCapture';
import { CameraIcon, ImageIcon } from './Icons';
import { Button } from './ui';

const LABEL = { post: 'Post', reel: 'Reel', story: 'Story' };
const OK_TYPE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/;
const REEL_MAX_ITEMS = 10;
const DEFAULT_SECONDS = 5; // how long a photo shows in a reel unless changed
const MIN_SECONDS = 1;
const MAX_SECONDS = 30;

let nextId = 0;
const release = (it) => URL.revokeObjectURL(it.preview);

/**
 * One place to share a post, a reel or a 24-hour story, from files or straight from the camera.
 * A reel can hold several photos and videos, played one after another: each photo shows for 5 seconds
 * unless you change it (1 to 30 s), a video plays for its own length.
 */
export function Composer({ name, onPosted, onStoryPosted, request, onDone }) {
  const [kind, setKind] = useState('post');
  const [caption, setCaption] = useState('');
  const [items, setItems] = useState([]); // [{ id, file, preview, isVideo, seconds }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [done, setDone] = useState('');
  const input = useRef(null);
  const box = useRef(null);
  const text = useRef(null);
  const live = useRef(items);
  live.current = items;

  // A + button elsewhere asked for this composer: switch to the requested kind, scroll here and focus.
  useEffect(() => {
    if (!request) return;
    changeKind(request.kind);
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    text.current?.focus({ preventScroll: true });
  }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => live.current.forEach(release), []); // free the previews when the composer goes away

  // Only a reel holds several files; going back to a post or story keeps the first one.
  function changeKind(next) {
    setKind(next);
    setError('');
    setDone('');
    if (next !== 'reel' && live.current.length > 1) {
      live.current.slice(1).forEach(release);
      setItems(live.current.slice(0, 1));
    }
  }

  const pick = (list) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setDone('');
    const accepted = [];
    let problem = '';
    for (const f of files) {
      const type = f.type.split(';')[0];
      if (!OK_TYPE.test(type)) problem = 'Choose a JPG, PNG, WebP or GIF photo, or an MP4 or WebM video.';
      else if (type.startsWith('image/') && f.size > MAX_IMAGE_BYTES) problem = 'Photos can be up to 5 MB.';
      else if (type.startsWith('video/') && f.size > MAX_VIDEO_BYTES) problem = 'Videos can be up to 50 MB.';
      else accepted.push({ id: ++nextId, file: f, preview: URL.createObjectURL(f), isVideo: type.startsWith('video/'), seconds: DEFAULT_SECONDS });
    }
    if (!accepted.length) return setError(problem);

    // A video picked while writing a plain post defaults to a reel.
    const target = kind === 'post' && accepted.some((i) => i.isVideo) ? 'reel' : kind;
    if (target !== kind) setKind(target);

    if (target !== 'reel') {
      // post or story: one photo or video, the new pick replaces the old
      live.current.forEach(release);
      accepted.slice(1).forEach(release);
      setItems(accepted.slice(0, 1));
      setError(accepted.length > 1 ? 'Only a reel can have several photos and videos. The first one was used.' : problem);
      return;
    }
    const room = REEL_MAX_ITEMS - live.current.length;
    accepted.slice(Math.max(room, 0)).forEach(release);
    setItems([...live.current, ...accepted.slice(0, Math.max(room, 0))]);
    setError(accepted.length > room ? `A reel can have up to ${REEL_MAX_ITEMS} photos and videos.` : problem);
  };

  const remove = (id) => {
    release(live.current.find((i) => i.id === id));
    setItems(live.current.filter((i) => i.id !== id));
    setError('');
    if (input.current) input.current.value = '';
  };
  const setSeconds = (id, s) => setItems(live.current.map((i) => (i.id === id ? { ...i, seconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, s)) } : i)));
  const move = (index, by) => {
    const to = index + by;
    if (to < 0 || to >= live.current.length) return;
    const next = [...live.current];
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  };

  const first = items[0];
  const photoSeconds = items.filter((i) => !i.isVideo).reduce((sum, i) => sum + i.seconds, 0);
  const canShare = !busy && (kind === 'post' ? !!caption.trim() || items.length > 0 : items.length > 0);

  const submit = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      if (kind === 'reel') {
        const uploaded = [];
        for (const it of items) uploaded.push({ key: (await uploadMedia(it.file)).key, ...(it.isVideo ? {} : { durationMs: it.seconds * 1000 }) });
        const post = await api('/posts', { method: 'POST', body: { caption, kind, items: uploaded } });
        onPosted(post);
        setDone('Your reel is up. Find it in Reels.');
      } else {
        const media = first ? await uploadMedia(first.file) : undefined;
        if (kind === 'story') {
          await api('/stories', { method: 'POST', body: { mediaKey: media.key, caption: caption || undefined } });
          onStoryPosted();
          setDone('Your story is live for 24 hours.');
        } else {
          const post = await api('/posts', { method: 'POST', body: { caption, mediaKey: media?.key, kind } });
          onPosted(post);
          setDone('Posted.');
        }
      }
      setCaption('');
      items.forEach(release);
      setItems([]);
      if (input.current) input.current.value = '';
      if (onDone) setTimeout(onDone, 1100); // let the success message show, then close the pop-up
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.caption ?? e.fields.items ?? e.message) : 'Could not share. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="composer" aria-label="Create" ref={box}>
      <div className="seg" role="tablist" aria-label="What are you sharing?">
        {Object.keys(LABEL).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => changeKind(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        ref={text}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={kind === 'story' ? 300 : 2200}
        rows={2}
        placeholder={kind === 'story' ? 'Add a caption (optional)' : `What are you sharing, ${name.split(' ')[0]}?`}
        aria-label="Caption"
      />

      {kind !== 'reel' && first && (
        <div className="composer-preview">
          {first.isVideo ? <video src={first.preview} controls playsInline muted /> : <img src={first.preview} alt="Selected photo preview" />}
          <button type="button" onClick={() => remove(first.id)} aria-label="Remove">
            ✕
          </button>
        </div>
      )}

      {kind === 'reel' && items.length > 0 && (
        <>
          <ul className="reel-items" aria-label="Photos and videos in this reel">
            {items.map((it, i) => (
              <li key={it.id}>
                <div className="thumb">
                  {it.isVideo ? <video src={it.preview} muted playsInline preload="metadata" /> : <img src={it.preview} alt="" />}
                  <span className="num">{i + 1}</span>
                </div>
                <div className="meta">
                  <strong>{it.isVideo ? 'Video' : 'Photo'}</strong>
                  {it.isVideo ? (
                    <small>Plays for its full length</small>
                  ) : (
                    <div className="stepper" role="group" aria-label={`How long photo ${i + 1} shows`}>
                      <button type="button" onClick={() => setSeconds(it.id, it.seconds - 1)} disabled={it.seconds <= MIN_SECONDS} aria-label="Show for 1 second less">
                        −
                      </button>
                      <output aria-live="polite">{it.seconds} s</output>
                      <button type="button" onClick={() => setSeconds(it.id, it.seconds + 1)} disabled={it.seconds >= MAX_SECONDS} aria-label="Show for 1 second more">
                        +
                      </button>
                    </div>
                  )}
                </div>
                <div className="acts">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move later">
                    ↓
                  </button>
                  <button type="button" onClick={() => remove(it.id)} aria-label="Remove from the reel">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="fine">
            {items.length} of {REEL_MAX_ITEMS} added{photoSeconds ? ` · photos show ${photoSeconds} s in total` : ''}. Use − and + to make a photo shorter or longer ({MIN_SECONDS}–{MAX_SECONDS} s).
          </p>
        </>
      )}

      {kind === 'reel' && items.length === 0 && (
        <p className="fine">A reel can have several photos and videos, one after another. Each photo shows for {DEFAULT_SECONDS} seconds — you can change that after adding it.</p>
      )}
      {kind === 'story' && !first && <p className="fine">A story is a photo or video that disappears after 24 hours.</p>}
      {error && (
        <p className="field-msg error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="notice" role="status">
          {done}
        </p>
      )}
      <div className="composer-bar">
        <input
          ref={input}
          type="file"
          multiple={kind === 'reel'}
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = ''; // so choosing the same file again still fires
          }}
        />
        <div className="composer-tools">
          <button type="button" className="act" onClick={() => input.current?.click()}>
            <ImageIcon />
            <span>{kind === 'reel' ? (items.length ? 'Add more' : 'Photos / videos') : 'Photo / video'}</span>
          </button>
          <button type="button" className="act" onClick={() => setCamera(true)}>
            <CameraIcon />
            <span>Camera</span>
          </button>
        </div>
        <Button busy={busy} disabled={!canShare} onClick={submit}>
          {kind === 'post' ? 'Share' : `Share ${LABEL[kind].toLowerCase()}`}
        </Button>
      </div>
      {camera && (
        <CameraCapture
          onClose={() => setCamera(false)}
          onCapture={(f) => {
            setCamera(false);
            pick([f]);
          }}
        />
      )}
    </section>
  );
}
