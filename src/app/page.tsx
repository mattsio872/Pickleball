import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { currentCustomer } from '@/lib/customer-auth';
import { formatPeso } from '@/lib/money';
import { timeLabel } from '@/lib/time';
import { SiteHeader } from '@/components/SiteHeader';
import { CourtMotif, CourtThumb } from '@/components/CourtMotif';

export const dynamic = 'force-dynamic';

const ADD_ONS = [
  { name: 'Paddle rental (per paddle)', cents: 12000 },
  { name: 'Tube of 3 outdoor balls', cents: 28000 },
  { name: 'Coaching, 1 hour', cents: 120000 },
  { name: 'Ball machine, 1 hour', cents: 45000 },
];

const STEPS = [
  { n: 1, title: 'Pick court and time', body: 'Live availability across every court, in 1 to 3 hour blocks.' },
  { n: 2, title: 'Pay online', body: 'GCash, Maya, online bank transfer or card. The slot locks the moment payment clears.' },
  { n: 3, title: 'Share the join link', body: 'Your players register themselves — names land on the desk roster.' },
  { n: 4, title: 'Scan in', body: 'One scan at the front desk verifies the booking, the court and that it is paid.' },
];

export default async function HomePage() {
  const settings = await getSettings();
  const customer = await currentCustomer();
  const courts = await prisma.court.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });

  const rate = formatPeso(settings.hourlyRateCents);
  const opens = timeLabel(settings.openHour * 60);
  const closes = timeLabel(settings.closeHour * 60);
  const longestBlock = Math.max(...settings.durationsMinutes);
  const lastSlot = timeLabel(settings.closeHour * 60 - Math.min(...settings.durationsMinutes));

  const faqs = [
    {
      q: 'Do you accept cash at the venue?',
      a: 'No. Court time is paid online only — GCash, Maya, online bank transfer or card. Add-ons at the desk are charged to the same booking.',
    },
    {
      q: 'What if a player arrives without registering?',
      a: `The desk can add them against your reference on the spot, as long as your pass has been scanned and you are within the ${settings.maxPlayers}-player limit.`,
    },
    {
      q: 'What if we cannot make our slot?',
      a: 'Court time is booked and paid for the slot you chose, and is not refundable. Message the desk as early as you can and we will do what we can to help.',
    },
    {
      q: 'Is one QR enough for the whole group?',
      a: "Yes. The booker's QR carries the reference; the court, slot, payment status and roster open from it on the desk's screen.",
    },
  ];

  return (
    <>
      <SiteHeader venueName={settings.venueName} city={settings.city} customerName={customer?.name} />

      <main style={{ paddingBottom: 64 }}>
        <section className="container hero-grid" style={{ padding: '64px 24px 72px' }}>
          <div style={{ maxWidth: 520 }}>
            <div className="eyebrow" style={{ marginBottom: 18 }}>
              Indoor pickleball · Members &amp; walk-ins
            </div>
            <h1 style={{ fontSize: 'clamp(38px,5vw,56px)', margin: '0 0 20px', textWrap: 'balance' }}>
              {courts.length === 3 ? 'Three courts.' : `${courts.length} courts.`} One rate. Booked in under a minute.
            </h1>
            <p
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: 'var(--color-neutral-700)',
                maxWidth: '44ch',
                marginBottom: 28,
                textWrap: 'pretty',
              }}
            >
              Reserve a court, pay by GCash, Maya or online bank transfer, and walk in with a QR pass the front desk
              scans on arrival. No cash, no queue, no paper.
            </p>
            <div className="row">
              <Link className="btn btn-primary" style={{ padding: '11px 20px', fontSize: 15 }} href="/book">
                Check availability
              </Link>
              <Link className="btn btn-secondary" style={{ padding: '11px 20px', fontSize: 15 }} href="#rates">
                See what&rsquo;s included
              </Link>
            </div>
            <div style={{ marginTop: 34, display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 30 }}>{rate}</span>
              <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
                per hour, per court — up to {settings.maxPlayers} players
              </span>
            </div>
          </div>
          <CourtMotif
            height={380}
            showHint={!settings.heroImageUrl}
            imageUrl={settings.heroImageUrl || undefined}
            alt={`Inside ${settings.venueName}`}
          />
        </section>

        <section className="stat-band">
          <div className="inner">
            <div>
              <div className="figure">{courts.length}</div>
              <div className="caption">cushioned indoor courts</div>
            </div>
            <div>
              <div className="figure">
                {opens.replace(':00', '')} – {closes.replace(':00', '')}
              </div>
              <div className="caption">daily, last slot {lastSlot.replace(':00', '')}</div>
            </div>
            <div>
              <div className="figure">Cashless</div>
              <div className="caption">GCash · Maya · online bank · card</div>
            </div>
            <div>
              <div className="figure">QR entry</div>
              <div className="caption">scanned &amp; verified at the desk</div>
            </div>
          </div>
        </section>

        <section id="courts" className="container" style={{ padding: '72px 24px 0' }}>
          <h2 style={{ marginBottom: 6 }}>The courts</h2>
          <p className="muted" style={{ fontSize: 14, marginBottom: 26 }}>
            Regulation 20 × 44 ft, permanent nets, 4m clearance.
          </p>
          <div className="card-grid">
            {courts.map((court) => (
              <article key={court.id} className="card elev-sm">
                <CourtThumb imageUrl={court.imageUrl || undefined} alt={`Court ${court.code} — ${court.name}`} />
                <div className="card-kicker">Court {court.code}</div>
                <div className="card-title">{court.name}</div>
                <p className="card-body">{court.blurb}</p>
                <div className="card-meta">{court.meta}</div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="rates"
          className="container"
          style={{
            padding: '72px 24px 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
            gap: 44,
          }}
        >
          <div>
            <h2 style={{ marginBottom: 6 }}>One flat rate</h2>
            <p className="muted" style={{ fontSize: 14, marginBottom: 22 }}>
              No peak surcharge, no membership required.
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 52, color: 'var(--color-accent-600)' }}>
                {rate}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                / hour / court
              </span>
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 14,
                color: 'var(--color-neutral-700)',
              }}
            >
              <li>
                Court for up to {settings.maxPlayers} players, {Math.min(...settings.durationsMinutes) / 60}–
                {longestBlock / 60} hour blocks
              </li>
              <li>Net, balls and towel service included</li>
              <li>Locker and shower access</li>
            </ul>
          </div>
          <div>
            <h4 style={{ marginBottom: 14 }}>Add-ons</h4>
            <table className="table">
              <tbody>
                {ADD_ONS.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td style={{ textAlign: 'right', color: 'var(--color-neutral-700)' }}>{formatPeso(a.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
              Add-ons are settled at the desk against your booking — still cashless.
            </p>
          </div>
        </section>

        <section className="container" style={{ padding: '72px 24px 0' }}>
          <h2 style={{ marginBottom: 26 }}>How it works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 22 }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{ paddingTop: 16, borderTop: '1px solid var(--color-divider)' }}>
                <div style={{ fontSize: 11, color: 'var(--color-accent)', letterSpacing: '0.1em', marginBottom: 8 }}>
                  0{s.n}
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 17, marginBottom: 6 }}>{s.title}</div>
                <p className="muted" style={{ fontSize: 13, margin: 0, textWrap: 'pretty' }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="faq"
          className="container"
          style={{
            padding: '72px 24px 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
            gap: 44,
          }}
        >
          <div>
            <h2>Questions</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Anything else — message the desk on Viber at {settings.contactViber}.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {faqs.map((f) => (
              <div key={f.q}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16, marginBottom: 5 }}>{f.q}</div>
                <p style={{ fontSize: 13.5, color: 'var(--color-neutral-700)', margin: 0, textWrap: 'pretty' }}>
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="container" style={{ padding: '80px 24px 0' }}>
          <div
            style={{
              borderRadius: 14,
              padding: 40,
              boxShadow: 'var(--shadow-sm)',
              background: 'linear-gradient(140deg,var(--color-neutral-100),var(--color-neutral-200))',
            }}
          >
            <h2 style={{ marginBottom: 10 }}>Courts open tomorrow at {opens.replace(':00', '')}.</h2>
            <p style={{ color: 'var(--color-neutral-700)', fontSize: 15, maxWidth: '48ch' }}>
              Pick a slot, pay online, share the join link with your group. Everyone checks in with one scan.
            </p>
            <Link className="btn btn-primary" style={{ padding: '11px 20px', fontSize: 15 }} href="/book">
              Book a court
            </Link>
          </div>
          <div
            style={{
              marginTop: 56,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--color-neutral-700)',
            }}
          >
            <span>
              {settings.venueName} · {settings.city}
            </span>
            <span>Cashless venue · GCash · Maya · InstaPay · PESONet</span>
            <Link href="/desk" style={{ color: 'var(--color-neutral-700)' }}>
              Staff
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
