// The username of the account created or used last on this device, so the sign-in page can suggest it (one tap, no typing mistakes).
// Only the username is kept (it is public on the profile anyway); never the password, email or phone.
const KEY = 'mirra.signinId';

export const getSignInId = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};
export const saveSignInId = (username) => {
  try {
    localStorage.setItem(KEY, username);
  } catch {
    /* storage blocked: the suggestion is just skipped */
  }
};
export const clearSignInId = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
