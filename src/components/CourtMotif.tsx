/**
 * The generated court artwork from the design, standing in until the venue
 * supplies photographs. Kept as a component so replacing it with an <img> later
 * is a one-file change.
 */
export function CourtMotif({ height, showHint = false }: { height: number; showHint?: boolean }) {
  return (
    <div className="motif" style={{ height }}>
      <div
        className="motif-ball"
        style={{
          right: -70,
          bottom: -70,
          width: 330,
          height: 330,
          backgroundColor: 'var(--color-accent-400)',
          boxShadow: 'var(--shadow-md)',
        }}
      />
      <div
        className="motif-ball"
        style={{
          left: -50,
          top: -50,
          width: 190,
          height: 190,
          backgroundColor: 'var(--color-accent-2-500)',
          backgroundSize: '40px 40px',
          opacity: 0.95,
        }}
      />
      {showHint && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            left: 32,
            bottom: 30,
            fontSize: 10.5,
            letterSpacing: '0.1em',
            color: 'var(--color-neutral-700)',
          }}
        >
          [ drop a court photo here — motif shows meanwhile ]
        </div>
      )}
    </div>
  );
}

/** The smaller motif used on court cards. */
export function CourtThumb() {
  return (
    <div className="motif" style={{ height: 120, borderRadius: 8 }}>
      <div
        className="motif-ball"
        style={{
          right: -24,
          bottom: -30,
          width: 120,
          height: 120,
          backgroundColor: 'var(--color-accent-300)',
          backgroundImage: 'radial-gradient(var(--color-neutral-100) 4.5px, transparent 5px)',
          backgroundSize: '34px 34px',
        }}
      />
    </div>
  );
}
