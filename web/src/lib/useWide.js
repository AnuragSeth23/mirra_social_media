import { useEffect, useState } from 'react';

/** True while the window is at least `px` wide. Used to decide where a panel lives (side rail or inside the feed). */
export function useWide(px) {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}
