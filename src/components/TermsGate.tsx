// Asks signed-in people to accept the current Terms of Service and Privacy
// Policy (and, for accounts made before we asked, their date of birth) before
// they keep using Venband. Shown once per new version of the terms.
import { useEffect, useState } from 'react';
import { acceptTerms, myLegalStatus, type LegalStatus } from '../lib/legal';
import { errorMessage } from '../lib/supabase';
import { signOut } from '../lib/session';
import { BirthdayPicker, LegalLinks, birthDate } from './LegalBits';
import { Field, Modal } from './ui';

export function TermsGate() {
  const [status, setStatus] = useState<LegalStatus | null>(null);
  const [birthday, setBirthday] = useState({ y: '', m: '', d: '' });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    myLegalStatus().then(setStatus);
  }, []);

  if (!status || !status.needs_terms) return null;

  async function submit() {
    setError(null);
    let born: string | null = null;
    if (status!.needs_birth_date) {
      born = birthDate(birthday.y, birthday.m, birthday.d);
      if (!born) return setError('Enter your date of birth.');
    }
    setBusy(true);
    try {
      await acceptTerms(born);
      setStatus({ needs_terms: false, needs_birth_date: false });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="We updated our terms" onClose={() => {}} className="terms-gate">
      <p className="muted">
        Please read and accept the updated <LegalLinks /> to keep using Venband. In short: be kind, stay legal, and you’re responsible for what you post. Your
        messages stay end-to-end encrypted.
      </p>
      {status.needs_birth_date && (
        <Field label="Date of birth" hint="Only used to confirm you’re 13 or older. Nobody else can see it.">
          <BirthdayPicker value={birthday} onChange={setBirthday} />
        </Field>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I’m 13 or older and I agree to <LegalLinks />.
        </span>
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={() => signOut('You logged out. Accept the terms next time to keep using Venband.')}>
          Log out
        </button>
        <button className="btn primary" disabled={!agreed || busy} onClick={submit}>
          {busy ? 'Saving…' : 'Agree and continue'}
        </button>
      </div>
    </Modal>
  );
}
