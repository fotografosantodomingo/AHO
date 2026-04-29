import { z } from 'zod';

/**
 * Shared Zod schemas for the auth forms. Same schema runs client-side (React
 * Hook Form via `zodResolver`) and is available for any future server-action
 * variant. Validation is UX-grade — Supabase enforces its own password policy
 * server-side, and we surface its errors verbatim if our checks pass but
 * Supabase rejects.
 */

export const SignInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const SignUpSchema = z
  .object({
    email: z.string().trim().email(),
    password: z
      .string()
      .min(8, { message: 'min8' })
      .regex(/[A-Z]/, { message: 'needsUppercase' })
      .regex(/[0-9]/, { message: 'needsNumber' }),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'mustAcceptTerms' }),
    }),
    marketingOptIn: z.boolean().optional().default(false),
  })
  // The error messages above use stable codes, not localized text — the form
  // component looks them up against the active locale's translations.
  .strict();
export type SignUpInput = z.infer<typeof SignUpSchema>;

/** Forgot-password / magic-link forms — just an email. */
export const EmailOnlySchema = z.object({
  email: z.string().trim().email(),
});
export type EmailOnlyInput = z.infer<typeof EmailOnlySchema>;

/**
 * Reset-password form — same strength rules as signup, plus confirmation.
 * `confirmPassword` is checked at the form layer; we validate matching there
 * to keep the schema reusable for non-form contexts (e.g., admin force-reset).
 */
export const ResetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, { message: 'min8' })
    .regex(/[A-Z]/, { message: 'needsUppercase' })
    .regex(/[0-9]/, { message: 'needsNumber' }),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
