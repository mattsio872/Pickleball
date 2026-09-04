'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/client';

/** Sign in, or create an account. One component so the two stay consistent. */
export function CustomerAuthForm({ mode, next }: { mode: 'signin' | 'register'; next: string }) {
  const router = useRouter();
  const registering = mode === 'register';

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api(registering ? '/api/customer/register' : '/api/customer/login', {
        method: 'POST',
        body: JSON.stringify(registering ? { name, mobile, email, password } : { email, password }),
      });
      router.push(next);
      router.refresh();
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiRequestError) {
        setError(e.message);
        if (e.failure.details) setFieldErrors(e.failure.details);
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="field" style={{ marginBottom: 14 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        aria-invalid={Boolean(fieldErrors[id.replace('cust-', '')])}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {fieldErrors[id.replace('cust-', '')] && (
        <div className="field-error">{fieldErrors[id.replace('cust-', '')][0]}</div>
      )}
    </div>
  );

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="banner banner-error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {registering && (
        <>
          {field('cust-name', 'Your name', name, setName, { autoComplete: 'name', required: true })}
          {field('cust-mobile', 'Mobile number', mobile, setMobile, {
            autoComplete: 'tel',
            inputMode: 'tel',
            placeholder: '0917 000 0000',
            required: true,
          })}
        </>
      )}

      {field('cust-email', 'Email address', email, setEmail, {
        type: 'email',
        autoComplete: 'email',
        required: true,
      })}
      {field('cust-password', 'Password', password, setPassword, {
        type: 'password',
        autoComplete: registering ? 'new-password' : 'current-password',
        required: true,
        ...(registering ? { minLength: 8, placeholder: 'At least 8 characters' } : {}),
      })}

      <button className="btn btn-primary btn-block" style={{ padding: 11 }} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" /> {registering ? 'Creating your account…' : 'Signing in…'}
          </>
        ) : registering ? (
          'Create account'
        ) : (
          'Sign in'
        )}
      </button>

      <p className="muted" style={{ fontSize: 13, marginTop: 18, textAlign: 'center' }}>
        {registering ? (
          <>
            Already have an account? <Link href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
