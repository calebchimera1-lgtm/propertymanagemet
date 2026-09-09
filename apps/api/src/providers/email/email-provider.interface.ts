export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * The seam for outbound email.
 *
 * Version 1 ships the console adapter: the flows are real and fully
 * implemented, but nothing is delivered. Supplying SMTP credentials and
 * switching EMAIL_DRIVER makes them live with no change to domain code.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
