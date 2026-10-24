import { useEffect } from 'react';
import { CloseIcon } from './Icons';

/** Pop-up viewer: dims the page, closes on Esc, the X button or a click outside, and stops the page behind from scrolling. */
export function PostModal({ onClose, children, label = 'Post' }) {
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
