import { Resend } from 'resend';
import { emailLive, env } from './env';
import { formatPeso } from './money';
import { longDateLabel, minutesIntoDayOf, timeLabel, dayKeyOf } from './time';
import { joinUrl, passPageUrl, renderQrDataUrl, passUrl } from './pass';
import type { Booking, Court } from '@prisma/client';

/**
 * Transactional email.
 *
 * When RESEND_API_KEY is absent the pass is written to the server log instead
 * of being sent, so a local run still shows exactly what the booker would have
 * received — and a missing key never fails a payment that has already cleared.
 */

let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(env().RESEND_API_KEY);
  return client;
}

export type PassEmailInput = {
  booking: Booking & { court: Court };
  venueName: string;
  city: string;
  timezone: string;
  contactViber: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function renderPassEmail(input: PassEmailInput, qrDataUrl: string): { subject: string; html: string; text: string } {
  const { booking, venueName, timezone } = input;
  const day = longDateLabel(dayKeyOf(booking.startsAt, timezone), timezone);
  const from = timeLabel(minutesIntoDayOf(booking.startsAt, timezone));
  const to = timeLabel(minutesIntoDayOf(booking.endsAt, timezone));
  const court = `Court ${booking.court.code} · ${booking.court.name}`;
  const total = formatPeso(booking.totalCents);
  const subject = `${booking.ref} — your court is booked, ${day}`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:9px 0;color:#75798c;font-size:13px">${escapeHtml(label)}</td>
      <td style="padding:9px 0;text-align:right;font-size:14px;color:#161826">${escapeHtml(value)}</td>
    </tr>`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f3f5fe;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#5d5294;margin-bottom:18px">Entry pass</div>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:600;color:#161826">You're on the court.</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#595d6c">
      Show this QR at the front desk. The scan verifies your booking, the court and that payment cleared.
    </p>

    <div style="background:#ffffff;border-radius:14px;padding:26px;text-align:center">
      <img src="${qrDataUrl}" alt="Entry pass QR code for ${escapeHtml(booking.ref)}" width="240" height="240" style="display:block;margin:0 auto 18px;width:240px;height:240px">
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;letter-spacing:0.06em;color:#161826">${escapeHtml(booking.ref)}</div>
      <div style="margin-top:6px;font-size:12px;color:#75798c">${escapeHtml(court)} · ${escapeHtml(day)}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:26px">
      ${row('Venue', `${venueName} · ${input.city}`)}
      ${row('Court', court)}
      ${row('When', `${day}, ${from} – ${to}`)}
      ${row('Paid', total)}
      ${row('Booker', booking.customerName)}
    </table>

    <div style="margin-top:26px;padding:18px;background:#e7e5fe;border-radius:10px">
      <div style="font-size:14px;font-weight:600;color:#161826;margin-bottom:6px">Your players check themselves in</div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#595d6c">
        Send this link to your group. Each player registers their own name, and appears on the desk's roster when your pass is scanned.
      </p>
      <a href="${joinUrl(booking)}" style="font-size:13px;color:#5d5294">${escapeHtml(joinUrl(booking))}</a>
    </div>

    <p style="margin:26px 0 0;font-size:12px;line-height:1.7;color:#75798c">
      Lost this email? Your pass lives at <a href="${passPageUrl(booking)}" style="color:#5d5294">this link</a>.<br>
      Questions? Message the desk on Viber at ${escapeHtml(input.contactViber)}.
    </p>
  </div>
</body></html>`;

  const text = [
    `${venueName} — entry pass`,
    '',
    `Reference: ${booking.ref}`,
    `Court:     ${court}`,
    `When:      ${day}, ${from} – ${to}`,
    `Paid:      ${total}`,
    `Booker:    ${booking.customerName}`,
    '',
    `Your pass:  ${passPageUrl(booking)}`,
    `Join link:  ${joinUrl(booking)}`,
    '',
    `Questions? Viber ${input.contactViber}.`,
  ].join('\n');

  return { subject, html, text };
}

export async function sendPassEmail(input: PassEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const qrDataUrl = await renderQrDataUrl(passUrl(input.booking));
  const { subject, html, text } = renderPassEmail(input, qrDataUrl);

  if (!emailLive()) {
    // Not an error: the booking is paid and the pass is valid either way.
    console.info(
      [
        '',
        '─── entry pass (email not configured, printing instead) ───',
        text,
        '───────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return { sent: false, reason: 'RESEND_API_KEY not set' };
  }

  try {
    const result = await resend().emails.send({
      from: env().EMAIL_FROM,
      to: input.booking.customerEmail,
      subject,
      html,
      text,
    });
    if (result.error) {
      console.error('[email] Resend rejected the pass email:', result.error);
      return { sent: false, reason: result.error.message };
    }
    return { sent: true };
  } catch (error) {
    // A failed send must never undo a successful payment; the booker can still
    // reach the pass by link, and the desk can look the booking up by reference.
    console.error('[email] Could not send the pass email:', error);
    return { sent: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
}
