'use client';

import { useState } from 'react';

export function CopyButton({ value, className = 'btn btn-secondary' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard access can be denied; the link is visible and selectable
          // next to the button either way.
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}
