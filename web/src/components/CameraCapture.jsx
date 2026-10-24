import { useEffect, useRef, useState } from 'react';
import { CameraIcon, CloseIcon, FlipIcon } from './Icons';

const MAX_SECONDS = 60;

/** Pick the first container the browser can record: Chrome/Firefox do WebM, Safari does MP4. */
const pickMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));

/** Full-screen camera. Take a photo, or hold a recording of up to 60 s. Returns the result as a File. */
export function CameraCapture({ onCapture, onClose }) {
  const video = useRef(null);
  const stream = useRef(null);
  const recorder = useRef(null);
  const [facing, setFacing] = useState('user');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setError('This browser can’t open the camera. Choose a file instead.');
      try {
        // Release the previous camera first: some phones can't open the other one while the first is still on.
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        const constraints = { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } };
        // A device without a microphone should still be able to take photos, so retry without audio.
        const s = await navigator.mediaDevices
          .getUserMedia({ video: constraints, audio: true })
          .catch((e) => (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? navigator.mediaDevices.getUserMedia({ video: constraints, audio: false }) : Promise.reject(e)));
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      } catch (e) {
        const name = e.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser’s site settings, then try again.'
            : name === 'NotReadableError'
              ? 'The camera is being used by another app. Close it and try again.'
              : 'No camera was found on this device.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facing]);

  // Closing the camera mid-recording discards the clip instead of attaching something the user cancelled.
  const discard = useRef(false);
  // React's dev mode mounts, unmounts and remounts once, so the flag must be reset on every mount.
  useEffect(() => {
    discard.current = false;
    return () => {
      discard.current = true;
      recorder.current?.state === 'recording' && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stopRecording();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function photo() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(new File([b], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  }

  function startRecording() {
    const mime = typeof MediaRecorder === 'undefined' ? undefined : pickMime();
    if (!stream.current || !mime) return setError('Video recording isn’t supported in this browser. Choose a file instead.');
    const chunks = [];
    const r = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      if (discard.current) return;
      const type = mime.split(';')[0];
      onCapture(new File(chunks, `video.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type }));
    };
    r.start(1000);
    recorder.current = r;
    setSeconds(0);
    setRecording(true);
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setRecording(false);
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={video} playsInline muted onLoadedData={() => setReady(true)} className={`camera-video ${facing === 'user' ? 'mirror' : ''}`} />
      <button type="button" className="cam-close" onClick={onClose} aria-label="Close camera">
        <CloseIcon />
      </button>
      {recording && (
        <div className="cam-timer" role="timer">
          ● {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
        </div>
      )}
      {error ? (
        <div className="cam-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <div className="cam-controls">
          <button type="button" className="cam-side" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={recording || !ready} aria-label="Switch camera">
            <FlipIcon />
          </button>
          <div className="cam-shutters">
            <button type="button" className="shutter" onClick={photo} disabled={recording || !ready} aria-label="Take photo">
              <CameraIcon />
            </button>
            <button
              type="button"
              className={`shutter rec ${recording ? 'on' : ''}`}
              onClick={recording ? stopRecording : startRecording}
              disabled={!ready && !recording}
              aria-label={recording ? 'Stop recording' : 'Record video'}
            >
              <span />
            </button>
          </div>
          <span className="cam-side" aria-hidden />
        </div>
      )}
      {!error && <p className="cam-hint">{recording ? 'Tap the red button to stop' : 'Camera = photo · Red = record video (up to 60 s)'}</p>}
    </div>
  );
}
