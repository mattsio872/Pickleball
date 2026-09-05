/**
 * The venue from above: every court, drawn to plan.
 *
 * Drawn rather than photographed, and drawn in code rather than shipped as a
 * bitmap: the plan has to say how many courts there are, and a picture of three
 * courts becomes a lie the day a fourth is added. It takes the count from the
 * database like everything else on the page, so the hero and the headline
 * cannot disagree.
 *
 * The ground and its dot grid come from the site's own neutrals; the court
 * itself keeps the diagram's cyan and pink, which read as a plan rather than as
 * interface. A photograph in Venue settings still wins — this is what shows
 * until there is one.
 */

/** Geometry, in the SVG's own units. One court, and the room around it. */
const COURT_WIDTH = 440;
const COURT_HEIGHT = 970;
const COURT_GAP = 130;
const MARGIN_X = 210;
const TOP = 250;

/** The three bands down a pickleball court: service, kitchen, service. */
const SERVICE_TOP = 325;
const KITCHEN = 290;
const SERVICE_BOTTOM = COURT_HEIGHT - SERVICE_TOP - KITCHEN - 16;
const LINE = 8; // the white lines between bands, and the centre line

const SURFACE = '#5ed0f2';
const KITCHEN_COLOUR = '#f4a8f4';
const NET = '#3d404b';
const POST = '#c9c9c9';

export function CourtPlan({
  courts = 3,
  height,
  hint,
}: {
  /** How many courts the venue actually has. */
  courts?: number;
  height: number;
  /** Shown small in the corner, for whoever can set a photograph. */
  hint?: string;
}) {
  const count = Math.max(1, Math.min(courts, 6));
  const width = MARGIN_X * 2 + count * COURT_WIDTH + (count - 1) * COURT_GAP;
  const viewBoxHeight = 1456;
  const netY = TOP + SERVICE_TOP + LINE + KITCHEN / 2;
  const half = (COURT_WIDTH - LINE) / 2;

  // The box takes the drawing's own proportions and treats `height` as a
  // ceiling, so the plan never sits in a band of empty grey on a narrow screen
  // — it simply gets smaller.
  return (
    <div
      className="motif motif-plan"
      style={{ aspectRatio: `${width} / ${viewBoxHeight}`, maxHeight: height, width: '100%' }}
    >
      <svg
        viewBox={`0 0 ${width} ${viewBoxHeight}`}
        role="img"
        aria-label={`Plan of the venue: ${count} indoor pickleball ${count === 1 ? 'court' : 'courts'} side by side`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="court-plan-dots" width="50" height="50" patternUnits="userSpaceOnUse">
            <circle cx="9" cy="9" r="4.5" fill="var(--color-neutral-300)" opacity="0.85" />
          </pattern>
        </defs>

        {/* Two rects rather than one: the ground has to sit a shade below the
            white court frames, or the surround the plan is drawn with
            disappears into the page. */}
        <rect width={width} height={viewBoxHeight} fill="var(--color-neutral-200)" />
        <rect width={width} height={viewBoxHeight} fill="var(--color-neutral-300)" opacity="0.45" />
        <rect width={width} height={viewBoxHeight} fill="url(#court-plan-dots)" />

        {/* Faint setting-out lines, as on a drawing. */}
        <g stroke="var(--color-neutral-300)" strokeWidth="2" opacity="0.7">
          <line x1={width / 4} y1={0} x2={width / 4} y2={viewBoxHeight} />
          <line x1={(width * 3) / 4} y1={0} x2={(width * 3) / 4} y2={viewBoxHeight} />
          <line x1={0} y1={400} x2={width} y2={400} />
          <line x1={0} y1={1040} x2={width} y2={1040} />
        </g>

        {Array.from({ length: count }, (_, index) => {
          const x = MARGIN_X + index * (COURT_WIDTH + COURT_GAP);
          const kitchenY = TOP + SERVICE_TOP + LINE;
          const bottomY = kitchenY + KITCHEN + LINE;

          return (
            <g key={index}>
              {/* The white surround, which the lines between bands continue. */}
              <rect
                x={x - 10}
                y={TOP - 10}
                width={COURT_WIDTH + 20}
                height={COURT_HEIGHT + 20}
                rx="12"
                fill="#ffffff"
              />
              <rect x={x} y={TOP} width={half} height={SERVICE_TOP} fill={SURFACE} />
              <rect x={x + half + LINE} y={TOP} width={half} height={SERVICE_TOP} fill={SURFACE} />
              <rect x={x} y={kitchenY} width={COURT_WIDTH} height={KITCHEN} fill={KITCHEN_COLOUR} />
              <rect x={x} y={bottomY} width={half} height={SERVICE_BOTTOM} fill={SURFACE} />
              <rect x={x + half + LINE} y={bottomY} width={half} height={SERVICE_BOTTOM} fill={SURFACE} />

              {/* The net, posts and all, crossing the kitchen. */}
              <line
                x1={x - 34}
                y1={netY}
                x2={x + COURT_WIDTH + 34}
                y2={netY}
                stroke={NET}
                strokeWidth="22"
                strokeLinecap="round"
              />

              {/* Between courts: the divider posts. */}
              {index < count - 1 && (
                <g fill={POST}>
                  <rect x={x + COURT_WIDTH + COURT_GAP / 2 - 17} y={TOP + 135} width="34" height="110" rx="17" />
                  <rect x={x + COURT_WIDTH + COURT_GAP / 2 - 17} y={TOP + 690} width="34" height="110" rx="17" />
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {hint && <div className="motif-hint mono">{hint}</div>}
    </div>
  );
}
