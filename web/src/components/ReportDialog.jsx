import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { PostModal } from './PostModal';
import { Button, FormAlert } from './ui';

const REASONS = [
  ['spam', 'Spam'],
  ['scam', 'Scam or fraud'],
  ['harassment', 'Bullying or harassment'],
  ['hate', 'Hate speech'],
  ['violence', 'Violence or threats'],
  ['nudity', 'Nudity or sexual content'],
  ['self_harm', 'Self-harm'],
  ['other', 'Something else'],
];

/** Pop-up form that files a report about a user, post or comment. */
export function ReportDialog({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/safety/report', { method: 'POST', body: { targetType, targetId, reason, details: details.trim() || undefined } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the report. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PostModal onClose={onClose} label="Report">
      <form className="panel" onSubmit={submit}>
        {sent ? (
          <>
            <h2>Thanks for letting us know</h2>
            <p className="fine">Our team will review this. You won’t be told the outcome, and the person is not told you reported them.</p>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <h2>Report {targetType}</h2>
            {error && <FormAlert>{error}</FormAlert>}
            <fieldset className="reasons">
              <legend className="fine">Why are you reporting this?</legend>
              {REASONS.map(([value, label]) => (
                <label key={value} className="switch">
                  <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="fine">More details (optional)</span>
              <textarea className="plain-area" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} />
            </label>
            <div className="row">
              <Button type="submit" busy={busy}>
                Send report
              </Button>
              <Button type="button" variant="quiet" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form>
    </PostModal>
  );
}
