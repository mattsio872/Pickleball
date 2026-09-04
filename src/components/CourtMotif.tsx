/**
 * Court imagery.
 *
 * A photograph when the venue has supplied one, and the design's generated
 * artwork when it has not — so the site never shows a broken image or an empty
 * grey box, and photographs can be added one at a time without a deploy.
 *
 * Plain <img> rather than next/image: the URLs are entered by an admin and
 * could be any host, and next/image refuses a host that is not listed in the
 * build configuration. A wrong URL should be a wrong picture, not a 500.
 */
export function CourtMotif({
  height,
  showHint = false,
  imageUrl,
  alt,
}: {
  height: number;
  showHint?: boolean;
  imageUrl?: string;
  alt?: string;
}) {
  if (imageUrl) {
    return (
      <div className="motif motif-photo" style={{ height }}>
        <img src={imageUrl} alt={alt ?? ''} loading="lazy" />
      </div>
    );
  }

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
export function CourtThumb({ imageUrl, alt }: { imageUrl?: string; alt?: string }) {
  if (imageUrl) {
    return (
      <div className="motif motif-photo" style={{ height: 120, borderRadius: 8 }}>
        <img src={imageUrl} alt={alt ?? ''} loading="lazy" />
      </div>
    );
  }

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
