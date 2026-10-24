// Holds the short-lived verification ticket between sign-up and the code screens.
// sessionStorage keeps it across a reload but not across tabs or browser restarts; the ticket only
// permits submitting codes for this one account and expires after 30 minutes.

const KEY = 'socialambak-pending-verification';

export const savePending = (p) => sessionStorage.setItem(KEY, JSON.stringify(p));
export const clearPending = () => sessionStorage.removeItem(KEY);
export function loadPending() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return v?.ticket && Array.isArray(v.pending) ? v : null;
  } catch {
    return null;
  }
}
