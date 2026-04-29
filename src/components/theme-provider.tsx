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
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
