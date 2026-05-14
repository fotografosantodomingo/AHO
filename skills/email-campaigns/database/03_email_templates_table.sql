-- ============================================================================
-- email_templates: per-type, per-language editable copy for transactional
-- order emails (confirmation, tracking, refund, abandoned_cart, admin_*).
-- The send-order-email Edge Function reads from this table at send time
-- using the service role; if no matching row exists (or query fails), the
-- function falls back to the hardcoded defaults baked into its source.
--
-- HTML chrome (brand wordmark, accent rule, footer with tagline,
-- address, socials, copyright) stays in code — admins can only edit the
-- per-type copy here, not the layout.
--
-- Subject supports a single mustache placeholder: {{order_number}}.
--
-- ============================================================================
-- _consumer_note: These INSERT rows are STARTER VALUES, derived from the
-- defaults in content-template.json at the skill root. They use the brand
-- name "Kibay" and the domain "kibay.com.do" in the tracking outro and
-- abandoned-cart links — those are the only two body strings that mention
-- the brand by name.
--
-- After install, edit the rows in /admin/email/templates (no SQL, no
-- redeploy needed). Or, before first apply, edit the literal strings here
-- to match your brand. For a new vertical, see ../content-template.json
-- and ../examples/real-estate/ for a full non-wine example.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL
                    CHECK (type IN ('confirmation', 'tracking', 'refund',
                                    'abandoned_cart', 'admin_new_order',
                                    'admin_refunded')),
  lang            TEXT NOT NULL CHECK (lang IN ('es', 'en')),
  subject         TEXT NOT NULL,
  heading         TEXT NOT NULL,
  intro           TEXT NOT NULL,
  outro           TEXT,
  items_label     TEXT,
  subtotal_label  TEXT,
  shipping_label  TEXT,
  total_label     TEXT,
  ship_to_label   TEXT,
  tracking_label  TEXT,
  method_label    TEXT,
  cta_label       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (type, lang)
);

CREATE INDEX IF NOT EXISTS email_templates_type_lang_idx
  ON public.email_templates(type, lang);

DROP TRIGGER IF EXISTS email_templates_touch ON public.email_templates;
CREATE TRIGGER email_templates_touch BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_admin_all ON public.email_templates;
CREATE POLICY email_templates_admin_all ON public.email_templates
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed: starter defaults. Brand-name-bearing strings live in:
--   - tracking outro    ("¡Gracias por elegir <brand>!")
--   - abandoned_cart outro (mentions <brand>.com/cart)
--   - admin_* subjects  ("[<brand>] ...")
-- Edit these literals before applying, or update via /admin/email/templates
-- after install. 10 rows = 5 customer types × 2 langs + 2 admin × en-only.
-- ---------------------------------------------------------------------------

INSERT INTO public.email_templates
  (type, lang, subject, heading, intro, outro,
   items_label, subtotal_label, shipping_label, total_label, ship_to_label,
   tracking_label, method_label, cta_label)
VALUES
  -- confirmation / es
  ('confirmation', 'es',
   'Pedido confirmado — {{order_number}}',
   '¡Gracias por tu pedido!',
   'Recibimos tu pago y estamos preparando tu pedido. Te avisaremos cuando se envíe.',
   'Si tienes alguna pregunta, responde a este correo.',
   'Productos', 'Subtotal', 'Envío', 'Total', 'Envío a',
   NULL, NULL, NULL),

  -- confirmation / en
  ('confirmation', 'en',
   'Order confirmed — {{order_number}}',
   'Thanks for your order!',
   'We''ve received your payment and we''re preparing your order. We''ll let you know when it ships.',
   'If you have any questions, just reply to this email.',
   'Items', 'Subtotal', 'Shipping', 'Total', 'Ship to',
   NULL, NULL, NULL),

  -- tracking / es
  ('tracking', 'es',
   'Tu pedido va en camino — {{order_number}}',
   'Tu pedido está en camino',
   'Acabamos de enviar tu pedido. Aquí tienes los detalles para seguirlo.',
   'Te llegará pronto. ¡Gracias!',
   NULL, NULL, NULL, NULL, NULL,
   'Número de rastreo', 'Método', NULL),

  -- tracking / en
  ('tracking', 'en',
   'Your order is on its way — {{order_number}}',
   'Your order is on its way',
   'We just shipped your order. Here are the details to track it.',
   'You''ll have it soon. Thanks!',
   NULL, NULL, NULL, NULL, NULL,
   'Tracking number', 'Method', NULL),

  -- refund / es
  ('refund', 'es',
   'Reembolso procesado — {{order_number}}',
   'Reembolso procesado',
   'Hemos procesado el reembolso de tu pedido. El monto debería aparecer en tu cuenta en 5–10 días hábiles según tu banco.',
   'Si tienes alguna pregunta, responde a este correo.',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL),

  -- refund / en
  ('refund', 'en',
   'Refund processed — {{order_number}}',
   'Refund processed',
   'We''ve processed the refund for your order. It should appear on your account within 5–10 business days depending on your bank.',
   'If you have any questions, just reply to this email.',
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL),

  -- abandoned_cart / es
  ('abandoned_cart', 'es',
   '¿Olvidaste algo? — Pedido {{order_number}}',
   'Tu pedido te está esperando',
   'Vimos que empezaste un pedido pero no llegaste al pago. No te preocupes — está guardado por un rato más. Termina cuando puedas.',
   'Si decides terminar la compra, vuelve a tu carrito o responde a este correo si tienes alguna pregunta.',
   'Productos en tu carrito', 'Subtotal', 'Envío', 'Total', 'Envío a',
   NULL, NULL, 'Terminar mi pedido'),

  -- abandoned_cart / en
  ('abandoned_cart', 'en',
   'Did you forget something? — Order {{order_number}}',
   'Your order is still waiting',
   'We saw you started an order but didn''t make it to payment. Don''t worry — it''s still saved for a little while. Finish when you can.',
   'To finish your order, head to your cart or reply to this email with any questions.',
   'Items in your cart', 'Subtotal', 'Shipping', 'Total', 'Ship to',
   NULL, NULL, 'Finish my order'),

  -- admin_new_order / en (admin emails are en-only)
  ('admin_new_order', 'en',
   '[Admin] New order {{order_number}}',
   'New paid order',
   'A customer just completed checkout. Details below.',
   NULL,
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL),

  -- admin_refunded / en
  ('admin_refunded', 'en',
   '[Admin] Refunded {{order_number}}',
   'Order refunded',
   'A refund was processed for the order below.',
   NULL,
   NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL)
ON CONFLICT (type, lang) DO NOTHING;
