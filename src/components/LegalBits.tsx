// Small pieces shared by sign-up and the terms prompt.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** yyyy-mm-dd, or null when incomplete / not a real date. */
export function birthDate(y: string, m: string, d: string): string | null {
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1) return null; // e.g. 31 February
  return date.toISOString().slice(0, 10);
}

export function ageOn(iso: string, now = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

/** Month / day / year pickers (easier than a calendar on phones). */
export function BirthdayPicker({ value, onChange }: { value: { y: string; m: string; d: string }; onChange: (v: { y: string; m: string; d: string }) => void }) {
  const thisYear = new Date().getFullYear();
  return (
    <div className="birthday-row">
      <select aria-label="Month" value={value.m} onChange={(e) => onChange({ ...value, m: e.target.value })} required>
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="Day" value={value.d} onChange={(e) => onChange({ ...value, d: e.target.value })} required>
        <option value="">Day</option>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
      <select aria-label="Year" value={value.y} onChange={(e) => onChange({ ...value, y: e.target.value })} required>
        <option value="">Year</option>
        {Array.from({ length: 110 }, (_, i) => thisYear - 3 - i).map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "I agree" with links that open in a new tab, so the form keeps what you typed. */
export function LegalLinks() {
  const base = import.meta.env.BASE_URL;
  return (
    <>
      the{' '}
      <a href={`${base}tos`} target="_blank" rel="noopener noreferrer">
        Terms of Service
      </a>
      ,{' '}
      <a href={`${base}privacy`} target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>{' '}
      and{' '}
      <a href={`${base}guidelines`} target="_blank" rel="noopener noreferrer">
        Community Guidelines
      </a>
    </>
  );
}

