# Pickle Lounge

A working court-booking and payment system for an indoor pickleball venue, built
from the Pickle Lounge design mockup.

The mockup was a faithful prototype — it looked exactly like this — but nothing
behind it was real. Availability came from `((dayIdx * 31 + court * 17 + hour * 7) % 11) < 3`;
"Pay ₱650" flipped a variable; the QR carried its own claims in plain text
(`PAID:₱650/GCASH`) for anyone to reproduce; the staff view was a URL with no
password. This is the same product with those four things actually built.

---

## What it does

**For the customer**

- Browse live availability across every court, by date and block length
- Hold a slot, pay by GCash, Maya, online bank transfer or card
- Receive a signed QR entry pass by email
- Share a join link so each player registers themselves onto the party roster

**For the front desk**

- Sign in, scan an arriving pass with the device camera, or key the reference in
- See the court, slot, payment status and roster — read from the booking system,
  never from the pass itself
- Check players in and add walk-on guests up to the party limit

**For the venue owner**

- Edit the rate, opening hours, block lengths, hold window and party size
- Add, rename and retire courts
- Schedule maintenance closures per court or venue-wide
- See upcoming bookings, the last 24 hours of activity, and revenue booked

---

## Getting it running

Requires Node 20+ and Docker (or any Postgres 14+).

```bash
git clone <this repo> && cd Pickleball
npm install

cp .env.example .env
# Generate a real APP_SECRET and paste it into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d          # Postgres on :5432, plus the test database
npm run setup                 # generate client, apply migrations, seed
npm run dev
```

Open http://localhost:3000. Seeded staff logins (change them before production):

| Screen                                 | Email                   | Password    |
| -------------------------------------- | ----------------------- | ----------- |
| [Front desk](http://localhost:3000/desk)   | `desk@picklelounge.ph`  | `desk1234`  |
| [Admin](http://localhost:3000/admin)       | `admin@picklelounge.ph` | `admin1234` |

**No payment credentials are needed to try the whole flow.** Without them the app
runs a built-in sandbox gateway: a real local checkout page where you choose the
outcome, which then posts a *signed webhook through the real webhook endpoint*.
The confirmation path, idempotency handling and pass issuance are the same code
as in production — only the counterparty changes. Every screen involved says so.

Likewise, without `RESEND_API_KEY` the pass email is printed to the server console
rather than sent, so you can read exactly what the booker would have received.

```bash
npm test          # 87 tests
npm run typecheck
npm run build
```

---

## How the important parts work

### Double-booking is prevented by the database, not by a check

An application-level "is this slot free?" followed by an insert is a race: two
requests can both read *free* and both insert. The real guarantee is a Postgres
exclusion constraint ([`prisma/migrations/20260904120000_no_overlapping_bookings`](prisma/migrations/20260904120000_no_overlapping_bookings/migration.sql)):

```sql
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('HELD', 'CONFIRMED'));
```

The application still checks first — but only so the customer gets *"that slot
has just been taken"* instead of a stack trace. Correctness comes from the
constraint. The half-open range `[)` is deliberate: a booking ending at 8PM and
one starting at 8PM do not conflict, which is how back-to-back court slots should
behave.

The test suite fires 25 concurrent requests at one slot and asserts that exactly
one wins ([`tests/booking.test.ts`](tests/booking.test.ts)).

This is why Postgres is the database in development too. Developing against
SQLite would mean testing a system that *cannot* enforce the guarantee the
production one relies on.

### Holds expire, and expiry is swept before every read

A slot is held while the booker completes checkout, then released. Because the
exclusion constraint treats every `HELD` row as occupying the court — including
one abandoned at the payment screen — `releaseExpiredHolds()` runs before any
availability read or booking write. Without that sweep an abandoned hold would
block the slot forever.

### A booking is confirmed only by a verified provider event

The browser returning to the success URL confirms nothing; a customer can visit
that URL by hand. Confirmation happens in
[`src/app/api/webhooks/payments/route.ts`](src/app/api/webhooks/payments/route.ts),
and only after the signature verifies.

Applying an event is idempotent: the event is recorded first under a unique
constraint on `(provider, eventId)`, so a redelivery collides and returns before
anything is confirmed or emailed twice. The pass email is sent only on the
*transition* into `CONFIRMED`. (Tested: four paid deliveries, one email.)

One edge case is handled explicitly rather than ignored: if payment clears after
the hold lapsed *and* somebody else has taken the court, the booking is not
confirmed. The payment is recorded as `PAID` and a message naming the amount,
the provider payment id and the customer's email is logged for refund — because
silently keeping money for a court the party cannot use is the worst available
outcome.

### The QR pass asserts nothing

The mockup's QR said `PAID:₱650/GCASH`. This one encodes a reference and an
HMAC signature over it, and nothing else. The desk learns the court, the slot
and the payment status from the database.

The signature mixes the app secret with a per-booking secret, so one booking's
pass can be revoked by rotating that row's secret without invalidating every
pass ever issued. A tampered signature, a stolen signature from another booking,
and a well-formed pass for a cancelled booking are three distinct outcomes at
the desk — the last one is *valid but do not admit*, which is different from a
forgery.

### Money is integers

Court time is priced per hour but sold in fractional-hour blocks, so everything
is centavos. `priceFor(65000, 90) === 97500`, exactly, with no float anywhere
near the amount sent to the payment provider.

### Times are venue-local, stored as UTC

"7PM on the 10th" means 7PM in Quezon City regardless of where the booker or the
server is. [`src/lib/time.ts`](src/lib/time.ts) is the only place the two
representations meet. The timezone is a setting, and the tests cover a zone that
actually observes DST to prove the conversion is not accidentally UTC+8.

---

## Getting a live URL

The app needs a server and a database, so it has to be deployed somewhere.
Shortest path, about ten minutes:

1. **Database** — create a free project at [neon.tech](https://neon.tech) and
   copy the connection string.
2. **Deploy** — at [vercel.com/new](https://vercel.com/new), import this repo
   and set three environment variables:
   - `DATABASE_URL` — Neon's **pooled** connection string (hostname contains
     `-pooler`). This is what the running app uses.
   - `DIRECT_URL` — Neon's **direct / unpooled** string (same, without
     `-pooler`). Migrations use this.
   - `APP_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

   Migrations run automatically on deploy (see [`vercel.json`](vercel.json)).

   Why two database URLs: connection poolers do not support the DDL and
   advisory locks Prisma Migrate needs, so a deploy that migrates through the
   pooled URL fails. Serverless apps still want the pooled one at runtime. If
   you only set `DATABASE_URL`, the build falls back to it for migrations —
   correct for an unpooled database, and the reason a plain local Postgres
   needs no second variable.
3. **Seed it once.** The deploy creates the tables but leaves them empty — no
   courts means nothing to book — so this step is required. It runs from a
   clone of this repo on your own machine, not on Vercel. Needs Node 20+.

   ```bash
   git clone https://github.com/mattsio872/Pickleball.git
   cd Pickleball
   npm install
   ```

   **macOS / Linux** (bash or zsh):

   ```bash
   DATABASE_URL="<neon connection string>" \
   SEED_DESK_PASSWORD="<a real password>" \
   SEED_ADMIN_PASSWORD="<another real password>" \
     npm run db:seed
   ```

   **Windows PowerShell** — two differences. `VAR=value command` and trailing
   `\` are bash syntax and do not work; set the variables first, each on its
   own line. And use `npm.cmd`, not `npm`: PowerShell's default execution
   policy blocks `npm.ps1` with *"running scripts is disabled on this
   system"*, while `npm.cmd` bypasses it and needs no policy change.

   ```powershell
   $env:DATABASE_URL="<neon connection string>"
   $env:SEED_DESK_PASSWORD="<a real password>"
   $env:SEED_ADMIN_PASSWORD="<another real password>"
   npm.cmd run db:seed
   ```

   Substitute real values — the angle brackets are placeholders. A literal
   `<neon connection string>` produces *"the URL must start with the protocol
   postgresql://"*, and a literal password becomes your actual password.

   Expect:

   ```
   Created courts: A, B, C
   Venue settings ready.
   Created staff accounts: desk@picklelounge.ph, admin@picklelounge.ph
   ```

   Either Neon string works here — seeding does not touch the pooler
   restriction that migrations do.

   Re-running is safe and purely additive: nothing that already exists is
   modified, so a court you renamed in the admin UI survives, and **so does a
   password you regret**. To change one, see below.

If a deploy fails at **Collecting page data** naming a route you have never
touched, the real cause is a missing variable — the error names it a few lines
above. `APP_SECRET` is the usual one.

You now have a shareable URL. Payments run on the sandbox gateway and passes
print to the Vercel logs until you add the credentials below — everything else
is fully working, and every screen says which mode it is in.

## Going live

### 1. Database

Any Postgres 14+ with the `btree_gist` extension available (Neon, Supabase,
Vercel Postgres and RDS all qualify). Set `DATABASE_URL`, and `DIRECT_URL` too
if the database sits behind a connection pooler — see the note above. Migrations
run on deploy via the build command in [`vercel.json`](vercel.json).

**Finding the connection string on Neon:** open your project in the Neon
Console and use the **Connect** button on the project dashboard. The panel that
opens gives you the string, with a toggle between the *pooled* and *direct*
connection — you want both, one for each variable. The password is part of the
string; if the panel hides it there is a reveal control, and you can reset the
role's password from the **Roles** section if it is ever lost.

### 2. PayMongo

1. Create an account at [paymongo.com](https://www.paymongo.com) and complete
   business verification — **GCash, Maya and online banking each need approval
   on your account before they can be charged.** Test keys work immediately.
2. Copy the secret and public keys from Developers → API Keys into
   `PAYMONGO_SECRET_KEY` and `PAYMONGO_PUBLIC_KEY`.
3. Create a webhook pointing at `https://your-domain/api/webhooks/payments`,
   subscribed to `checkout_session.payment.paid` and `payment.failed`.
4. Copy the webhook signing secret (`whsk_…`) into `PAYMONGO_WEBHOOK_SECRET`.

The moment `PAYMONGO_SECRET_KEY` is set, the sandbox gateway is disabled and its
route returns 404 — there is no path that could confirm a booking without paying.

> **Verify this integration against PayMongo test keys before taking real
> payments.** PayMongo's documentation domains were unreachable from the
> environment this was built in, so the request shape and the
> `Paymongo-Signature` scheme (`t=…,te=…,li=…`, HMAC-SHA256 over
> `<t>.<raw body>`) were written from established usage rather than read off the
> live spec. The event parser is unit-tested against both envelope shapes, and
> the gateway is one file — [`src/lib/payments/paymongo.ts`](src/lib/payments/paymongo.ts) —
> if a field name needs correcting.

### 3. Email

Create a [Resend](https://resend.com) API key, verify your sending domain, and
set `RESEND_API_KEY` and `EMAIL_FROM`. A failed send never undoes a successful
payment: it is logged, and the booker can still reach their pass by link.

### 4. Secrets and accounts

- Set `APP_SECRET` to 32+ random bytes — the app refuses to serve without it,
  and a deploy that omits it fails while collecting page data. Changing it later
  invalidates every staff session and every issued pass.
- `NEXT_PUBLIC_SITE_URL` builds join links, pass links and the payment redirect
  URLs. On Vercel you can leave it unset for the first deploy — the platform's
  own domain is used automatically — then set it when you point a custom domain
  at the project.
- **Change the seeded staff passwords**, or seed with `SEED_DESK_PASSWORD` /
  `SEED_ADMIN_PASSWORD` set so the defaults never exist. Use
  `npm run staff:password` to change one afterwards.
- **Never paste a connection string into a chat, issue or commit** — it carries
  the database password. If one leaks, reset the role's password in the Neon
  console and update `DATABASE_URL` / `DIRECT_URL` wherever they are set.

### 5. Deploy

Push to a Vercel project with those environment variables set. The region is
pinned to `sin1` (Singapore) in `vercel.json` — closest to Manila.

---

## Project layout

```
prisma/
  schema.prisma              Domain model
  migrations/                Includes the hand-written exclusion constraint
  seed.ts                    Courts, settings, staff accounts
src/
  lib/
    availability.ts          Real availability from real bookings
    booking.ts               Holds, confirmation, cancellation
    checkout.ts              Booking ↔ payment orchestration, idempotency
    pass.ts                  Pass signing, verification, QR rendering
    payments/                Gateway interface, PayMongo, sandbox
    auth.ts                  scrypt passwords, signed staff sessions
    time.ts                  Venue-local ↔ UTC, the only place they meet
    money.ts                 Centavo arithmetic
  app/
    page.tsx                 Landing page
    book/                    Booking wizard
    pass/[token]/            The booker's pass
    join/[ref]/              Player self-registration
    desk/                    Staff scanner (camera + reference lookup)
    admin/                   Owner dashboard
    api/                     Route handlers
tests/                       87 tests, integration ones against real Postgres
```

## Seeding and staff passwords

`npm run db:seed` populates a database with the courts, venue settings and
staff accounts. It needs only `DATABASE_URL`, and generates the Prisma client
first, so it works on a fresh clone.

It is **additive only** — existing courts, settings and staff accounts are
never modified. That makes re-running safe, and it means the seed cannot be
used to fix a password.

### Changing a staff password

macOS / Linux:

```bash
DATABASE_URL="<connection string>" npm run staff:password -- admin@picklelounge.ph
```

Windows PowerShell (note `npm.cmd`):

```powershell
$env:DATABASE_URL="<connection string>"
npm.cmd run staff:password -- admin@picklelounge.ph
```

It prompts for the new password and masks what you type. Run it with no email
to list the accounts in the database.

For scripting, set `STAFF_PASSWORD` and it will not prompt — but that puts the
password in your shell history, so prefer the prompt when typing by hand. With
no interactive terminal and no `STAFF_PASSWORD`, it stops rather than reading
the password unmasked.

There is no password-change screen in the admin UI yet; this script is the way.

### Keeping credentials out of view

A connection string contains the database password. Do not paste one into a
chat, an issue, a screenshot or a commit. If one is exposed, reset the role's
password in the Neon console (**Roles → Reset password**), then update
`DATABASE_URL` and `DIRECT_URL` in Vercel and redeploy. The old string stops
working immediately.

## Deliberately not built

- **Cancellation and refunds.** The FAQ promises free cancellation up to 12
  hours before, and the setting exists and is displayed, but the customer-facing
  cancel flow and the provider refund call are not implemented. `cancelBooking()`
  and a `refund()` method on the gateway are in place to build on.
- **A staff-management screen.** Accounts are created by the seed and their
  passwords changed with `npm run staff:password`; there is no UI for adding,
  removing or editing staff.
- **Add-ons at the desk.** Listed on the rates section as the design has them,
  but charged manually — they are not part of the booking total.
