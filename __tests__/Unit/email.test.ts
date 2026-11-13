import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

import { sendEmail } from '../../src/lib/email';

const ORIGINAL_FROM = process.env.EMAIL_FROM;

beforeEach(() => {
  sendMock.mockReset();
  process.env.EMAIL_FROM = 'noreply@example.com';
});

afterEach(() => {
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL_FROM;
});

describe('sendEmail', () => {
  // Otherwise the reset email goes out twice, to the wrong address, or from a sender Resend refuses.
  it('sends the sender, recipient, subject, and text to Resend once', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null });

    await sendEmail({
      to: 'maker@example.com',
      subject: 'Reset your EvenCraft password',
      text: 'Reset link: https://example.com/reset?token=abc',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: 'EvenCraft <noreply@example.com>',
      to: 'maker@example.com',
      subject: 'Reset your EvenCraft password',
      text: 'Reset link: https://example.com/reset?token=abc',
    });
  });

  // Otherwise a server deployed without a sender address sends mail from "undefined".
  it('throws when EMAIL_FROM is not set and sends nothing', async () => {
    delete process.env.EMAIL_FROM;

    await expect(sendEmail({ to: 'maker@example.com', subject: 's', text: 't' })).rejects.toThrow(
      'EMAIL_FROM is not set',
    );

    expect(sendMock).not.toHaveBeenCalled();
  });

  // Otherwise an email Resend refused looks sent and the maker waits for a link that never comes.
  it("throws Resend's error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field' },
    });

    await expect(sendEmail({ to: 'bogus', subject: 's', text: 't' })).rejects.toThrow(
      'Resend error: validation_error: Invalid `to` field',
    );
  });
});
