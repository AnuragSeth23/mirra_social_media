import { useRef } from 'react';

/** Six single-digit boxes with paste, backspace and arrow-key support. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid, label }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const commit = (next, focusIndex) => {
    onChange(next);
    refs.current[Math.min(focusIndex, 5)]?.focus();
    if (next.length === 6) onComplete?.(next);
  };

  const handleInput = (i, raw) => {
    const d = raw.replace(/\D/g, '');
    if (!d) return;
    if (d.length > 1) return commit((value.slice(0, i) + d).slice(0, 6), i + d.length);
    const arr = digits.slice();
    arr[i] = d;
    commit(arr.join('').slice(0, 6), i + 1);
  };

  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = digits.slice();
      if (arr[i]) arr[i] = '';
      else if (i > 0) {
        arr[i - 1] = '';
        refs.current[i - 1]?.focus();
      }
      onChange(arr.join(''));
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const handlePaste = (e) => {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (d) {
      e.preventDefault();
      commit(d, d.length);
    }
  };

  return (
    <div className={`otp ${invalid ? 'has-error' : ''}`} role="group" aria-label={label} onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid}
        />
      ))}
    </div>
  );
}
