/**
 * Design tokens for the product.
 *
 * Values are HSL triplets (no `hsl()` wrapper) so Tailwind can compose them
 * with an alpha channel. They are emitted as CSS custom properties by the web
 * app's globals.css; this file is the written record of what those values mean
 * so a second surface (a PDF renderer, an email template) can match them.
 */
export const lightTokens = {
  background: '0 0% 100%',
  foreground: '222 47% 11%',
  card: '0 0% 100%',
  cardForeground: '222 47% 11%',
  popover: '0 0% 100%',
  popoverForeground: '222 47% 11%',
  primary: '222 72% 40%',
  primaryForeground: '210 40% 98%',
  secondary: '210 40% 96%',
  secondaryForeground: '222 47% 11%',
  muted: '210 40% 96%',
  mutedForeground: '215 16% 47%',
  accent: '210 40% 96%',
  accentForeground: '222 47% 11%',
  destructive: '0 72% 45%',
  destructiveForeground: '210 40% 98%',
  success: '142 71% 33%',
  successForeground: '210 40% 98%',
  warning: '38 92% 45%',
  warningForeground: '222 47% 11%',
  info: '199 89% 42%',
  infoForeground: '210 40% 98%',
  border: '214 32% 91%',
  input: '214 32% 91%',
  ring: '222 72% 40%',
} as const;

export const darkTokens = {
  background: '222 47% 8%',
  foreground: '210 40% 96%',
  card: '222 44% 11%',
  cardForeground: '210 40% 96%',
  popover: '222 44% 11%',
  popoverForeground: '210 40% 96%',
  primary: '213 90% 62%',
  primaryForeground: '222 47% 11%',
  secondary: '217 33% 18%',
  secondaryForeground: '210 40% 96%',
  muted: '217 33% 18%',
  mutedForeground: '215 20% 65%',
  accent: '217 33% 18%',
  accentForeground: '210 40% 96%',
  destructive: '0 72% 55%',
  destructiveForeground: '210 40% 98%',
  success: '142 65% 45%',
  successForeground: '222 47% 11%',
  warning: '38 92% 55%',
  warningForeground: '222 47% 11%',
  info: '199 89% 55%',
  infoForeground: '222 47% 11%',
  border: '217 33% 20%',
  input: '217 33% 20%',
  ring: '213 90% 62%',
} as const;

/**
 * Semantic status colours used consistently by badges, table cells and charts.
 * Defined once so "overdue" is the same red everywhere in the product.
 */
export const statusIntent = {
  neutral: 'muted',
  positive: 'success',
  warning: 'warning',
  negative: 'destructive',
  info: 'info',
} as const;

export type StatusIntent = keyof typeof statusIntent;
