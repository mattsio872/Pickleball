-- No two live bookings may ever overlap on the same court.
--
-- The application checks availability before writing, but a check followed by
-- an insert is a race: two requests can both read "free" and both insert. The
-- only way to make that impossible rather than unlikely is to let the database
-- reject the second write, so the guarantee lives here as a constraint.
--
-- HELD and CONFIRMED are the statuses that occupy a court; EXPIRED and
-- CANCELLED bookings are kept for the record but must not block the slot,
-- hence the partial predicate.
--
-- Ranges are half-open: a booking ending at 8PM and one starting at 8PM do not
-- overlap, which is exactly how back-to-back court slots should behave.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('HELD', 'CONFIRMED'));

-- A booking must occupy a positive span of time.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_positive_duration"
  CHECK ("endsAt" > "startsAt");

-- Money is stored in centavos and is never negative.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_nonnegative_total"
  CHECK ("totalCents" >= 0 AND "hourlyRateCents" >= 0);

-- Closures follow the same positive-span rule.
ALTER TABLE "closures"
  ADD CONSTRAINT "closures_positive_duration"
  CHECK ("endsAt" > "startsAt");

-- The settings table is a singleton: one row, always id = 1.
ALTER TABLE "settings"
  ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);
