'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

type NativeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
>;

interface Props extends NativeInputProps {
  /** Pass through className for the input (mirrors how the existing
   *  forms style their inputs — we just decorate with the toggle button). */
  className?: string;
}

/**
 * Password input with a show/hide eye-toggle. Wraps `<input>` so it
 * stays a drop-in replacement for the three signin/signup/reset-password
 * forms that previously used a bare `<input type="password">`.
 *
 * Why a separate component: every reuse needs (a) the same toggle UI,
 * (b) consistent ARIA on the toggle button, and (c) the toggle is
 * outside react-hook-form's `register` ref forwarding — solving it
 * inline three times would duplicate ~40 LOC each.
 *
 * `forwardRef` because react-hook-form's `register('password')`
 * returns a ref + onChange + onBlur + name that all need to attach
 * to the actual input element, not the wrapper div.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput({ className, ...inputProps }, ref) {
    const t = useTranslations('auth');
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          {...inputProps}
          className={
            // pr-12 reserves space for the toggle button so the typed
            // password never collides with the eye icon. Allow the
            // caller's className to override layout / focus / theme.
            `${className ?? ''} pr-12`
          }
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Toggle does not submit and is not in the tab order before
          // the input (placed AFTER in the DOM so Tab from input hits
          // the next field, not this button).
          aria-label={
            visible
              ? // Toggle currently shows plain text → button label says HIDE.
                (t.has('passwordHide')
                  ? t('passwordHide')
                  : 'Hide password')
              : (t.has('passwordShow')
                ? t('passwordShow')
                : 'Show password')
          }
          aria-pressed={visible}
          // Position the button vertically centered inside the input.
          // Same focus ring shape as the input so keyboard users see
          // continuity when they tab into it from outside.
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-helper transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action/50 dark:hover:text-ink-inverse"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Eye aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>
    );
  },
);
