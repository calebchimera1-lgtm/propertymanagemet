import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email-provider.interface';

/**
 * Development adapter. Writes the message to the server log instead of sending
 * it, so password-reset and verification links are usable locally without an
 * SMTP account.
 *
 * This is not a stub standing in for unwritten code: the flows that call it are
 * complete. It is the transport that is deliberately absent in V1, and the UI
 * never claims an email was delivered.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(
      [
        '',
        '──────────────────────────────────────────────────────────────',
        ' EMAIL NOT SENT (EMAIL_DRIVER=console)',
        ` To:      ${message.to}`,
        ` Subject: ${message.subject}`,
        '',
        message.text,
        '──────────────────────────────────────────────────────────────',
      ].join('\n'),
    );
  }
}
