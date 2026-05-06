import { z } from 'zod';
import { LEAD_SOURCES } from '@/db/schema';

/**
 * Public lead-creation schema. Routed through `POST /api/leads`.
 *
 * Anonymous buyers can submit; minimum required is the property + a contact
 * channel (email or phone). Source-specific minimums:
 *   - `form` → name, email, message all required
 *   - `whatsapp_click` → just property_id; other fields optional (we log the click)
 *   - `phone_click` / `email_click` → similar to whatsapp_click
 */
export const LeadCreateSchema = z
  .object({
    property_id: z.string().uuid(),
    source: z.enum(LEAD_SOURCES),
    contact_name: z.string().trim().max(120).optional(),
    contact_email: z.string().trim().email().optional(),
    contact_phone: z.string().trim().max(40).optional(),
    message: z.string().trim().max(4000).optional(),
    language: z.enum(['en', 'es']).optional(),
    /**
     * Honeypot field — the contact form renders a hidden input named
     * `website` outside the visible flow. Real users never see it; most
     * bots auto-fill every field they find. If anything other than an
     * empty string lands here, reject the submission.
     *
     * `.optional()` so the legitimate WhatsApp / phone-click paths
     * (which post directly without rendering the form) don't break.
     * The visible contact form always sends `website: ''`.
     */
    website: z
      .string()
      .max(0, { message: 'honeypot_filled' })
      .optional(),
    /**
     * Cloudflare Turnstile token — verified server-side via siteverify.
     * Required when source='form' AND the server has TURNSTILE_SECRET_KEY
     * configured (production). Other sources (whatsapp_click, phone_click,
     * email_click) bypass: those are user-initiated outbound clicks, not
     * spammable form submissions. Schema marks it `optional()` so the
     * non-form paths still parse; the route enforces presence per source.
     */
    captcha_token: z.string().min(1).max(2048).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.source === 'form') {
      if (!v.contact_email) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contact_email'],
          message: 'emailRequired',
        });
      }
      if (!v.contact_name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contact_name'],
          message: 'nameRequired',
        });
      }
      if (!v.message) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['message'],
          message: 'messageRequired',
        });
      }
    }
  });
export type LeadCreateInput = z.infer<typeof LeadCreateSchema>;
