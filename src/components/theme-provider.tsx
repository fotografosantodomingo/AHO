'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Wraps `next-themes` with the AHO defaults. Imports of this component must
 * be marked `use client` (handled by the directive at the top of this file).
 *
 * FOUC prevention is handled by an inline blocking script in the `<head>`
 * (see `src/app/[locale]/layout.tsx`); next-themes adds the right `class`
 * on the `<html>` element synchronously on first render before paint.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  // Default to dark per the brand direction (HashiCorp-inspired tokens read
  // best in dark mode for real-estate browsing). `enableSystem={false}` so
  // the toggle is a binary light↔dark switch — see ThemeToggle for the UX.
  // Users who set the cookie via the toggle persist it across visits;
  // first-time visitors see dark.
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
