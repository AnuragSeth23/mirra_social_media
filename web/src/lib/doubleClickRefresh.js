import { useEffect } from 'react';

// Only these keep their own double-click: text boxes (select a word), pop-ups (composer, share, post viewer) and video controls (full screen).
// Everything else on the page, photos, captions, cards, buttons and links included, refreshes the page.
const KEEP = 'input, textarea, select, [contenteditable="true"], [role="dialog"], .modal, video[controls]';

/** Double-click (or double-tap) anywhere on the page refreshes it. Used on Home and Reels. */
export function useDoubleClickRefresh() {
  useEffect(() => {
    const onDouble = (e) => {
      if (e.target instanceof Element && e.target.closest(KEEP)) return;
      window.location.reload();
    };
    document.addEventListener('dblclick', onDouble);
    return () => document.removeEventListener('dblclick', onDouble);
  }, []);
}
