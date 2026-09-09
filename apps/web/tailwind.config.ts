import type { Config } from 'tailwindcss';
import preset from '@pm/ui/tailwind-preset';

export default {
  presets: [preset],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
  ],
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
