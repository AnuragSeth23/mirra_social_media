import { useEffect, useRef, useState } from 'react';
import { api, ApiError, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, uploadMedia } from '../lib/api';
import { CameraCapture } from './CameraCapture';
import { CameraIcon, ImageIcon } from './Icons';
import { Button } from './ui';

const LABEL = { post: 'Post', reel: 'Reel', story: 'Story' };
const OK_TYPE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/;

/** One place to share a post, a reel (video) or a 24-hour story, from a file or straight from the camera. */
export function Composer({ name, onPosted, onStoryPosted, request, onDone }) {
  const [kind, setKind] = useState('post');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState(false);
  const [done, setDone] = useState('');
  const input = useRef(null);
  const box = useRef(null);
  const text = useRef(null);

  // A + button elsewhere asked for this composer: switch to the requested kind, scroll here and focus.
  useEffect(() => {
    if (!request) return;
    setKind(request.kind);
    setError('');
    setDone('');
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    text.current?.focus({ preventScroll: true });
  }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const isVideo = file?.type.startsWith('video/');

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pick = (f) => {
    if (!f) return;
    const type = f.type.split(';')[0];
    if (!OK_TYPE.test(type)) return setError('Choose a JPG, PNG, WebP or GIF photo, or an MP4 or WebM video.');
    if (type.startsWith('image/') && f.size > MAX_IMAGE_BYTES) return setError('Photos can be up to 5 MB.');
    if (type.startsWith('video/') && f.size > MAX_VIDEO_BYTES) return setError('Videos can be up to 50 MB.');
    setError('');
    setDone('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (type.startsWith('video/') && kind === 'post' && f.size > 0) setKind((k) => (k === 'post' ? 'reel' : k)); // a video defaults to a reel
  };
  const clear = () => {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = '';
  };

  const needsMedia = kind !== 'post';
  const canShare = !busy && (kind === 'post' ? !!caption.trim() || !!file : !!file && (kind !== 'reel' || isVideo));

  const submit = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const media = file ? await uploadMedia(file) : undefined;
      if (kind === 'story') {
        await api('/stories', { method: 'POST', body: { mediaKey: media.key, caption: caption || undefined } });
        onStoryPosted();
        setDone('Your story is live for 24 hours.');
      } else {
        const post = await api('/posts', { method: 'POST', body: { caption, mediaKey: media?.key, kind } });
        onPosted(post);
        setDone(kind === 'reel' ? 'Your reel is up. Find it in Reels.' : 'Posted.');
      }
      setCaption('');
      clear();
      if (onDone) setTimeout(onDone, 1100); // let the success message show, then close the pop-up
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.caption ?? e.message) : 'Could not share. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="composer" aria-label="Create" ref={box}>
      <div className="seg" role="tablist" aria-label="What are you sharing?">
        {Object.keys(LABEL).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'on' : ''}
            onClick={() => {
              setKind(k);
              setError('');
              setDone('');
            }}
          >
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
      {preview && (
        <div className="composer-preview">
          {isVideo ? <video src={preview} controls playsInline muted /> : <img src={preview} alt="Selected photo preview" />}
          <button type="button" onClick={clear} aria-label="Remove">
            ✕
          </button>
        </div>
      )}
      {needsMedia && !file && <p className="fine">{kind === 'reel' ? 'A reel is a video — pick one or record with the camera.' : 'A story is a photo or video that disappears after 24 hours.'}</p>}
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
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <div className="composer-tools">
          <button type="button" className="act" onClick={() => input.current?.click()}>
            <ImageIcon />
            <span>Photo / video</span>
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
            pick(f);
          }}
        />
      )}
    </section>
  );
}
