import { useNavigate } from 'react-router-dom';
import { BackIcon } from './Icons';

/** Goes to the previous screen; if this tab has no history (opened from a shared link), goes home instead. */
export function BackButton({ to, onClick, label = 'Back' }) {
  const navigate = useNavigate();
  const go = () => {
    if (onClick) return onClick();
    if (to) return navigate(to);
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  };
  return (
    <button type="button" className="back-btn" onClick={go} aria-label={label} title={label}>
      <BackIcon />
    </button>
  );
}
