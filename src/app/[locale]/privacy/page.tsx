import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';

export const runtime = 'edge';

const LAST_UPDATED = '2026-05-06';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'es' ? 'Política de Privacidad' : 'Privacy Policy',
    description:
      locale === 'es'
        ? 'Política de privacidad de AHO — qué datos recopilamos, por qué, con quién los compartimos y cómo ejercer tus derechos.'
        : 'AHO privacy policy — what data we collect, why, who we share it with, and how to exercise your rights.',
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: {
        en: '/en/privacy',
        es: '/es/privacidad',
      },
    },
    robots: { index: true, follow: true },
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      {locale === 'es' ? <PrivacyEs /> : <PrivacyEn />}
    </main>
  );
}

function ArticleShell({ children }: { children: React.ReactNode }) {
  return (
    <article className="prose prose-sm max-w-none [&_h1]:font-brand [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:font-brand [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-8 [&_h3]:font-brand [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-5 [&_p]:leading-relaxed [&_p]:text-ink-muted dark:[&_p]:text-ink-inverse-muted [&_li]:leading-relaxed [&_li]:text-ink-muted dark:[&_li]:text-ink-inverse-muted [&_a]:text-action [&_a]:underline-offset-2 [&_a]:hover:underline dark:[&_a]:text-action-dark">
      {children}
    </article>
  );
}

function PrivacyEn() {
  return (
    <ArticleShell>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-helper">Last updated: {LAST_UPDATED}</p>

      <p>
        This Privacy Policy describes how AHO (Advertise Homes Online), operating at{' '}
        <strong>advertisehomes.online</strong>, collects, uses, shares, and protects
        information about real-estate agents who subscribe to publish listings and the
        buyers who browse and contact them. Read it together with our{' '}
        <a href="/en/terms">Terms of Service</a>.
      </p>

      <h2>1. Who is responsible for your data</h2>
      <p>
        AHO operates the platform. For privacy questions, write to{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>.
        Postal correspondence is available on request.
      </p>

      <h2>2. What we collect, and why</h2>

      <h3>From everyone (browsing without an account)</h3>
      <ul>
        <li>
          <strong>Anonymous visitor cookie</strong> (one UUID, non-trackable across sites)
          — lets us remember your recently-viewed listings and saved searches across
          page reloads. Strictly functional; no advertising profiling.
        </li>
        <li>
          <strong>Device/connection metadata</strong> — IP address, user-agent, and
          referrer at the moment of a request. Used for rate-limiting against abuse and
          for diagnosing errors. Logs are retained for up to 30 days then aggregated.
        </li>
        <li>
          <strong>Bot-protection signal</strong> — when you submit a contact form or sign
          in, Cloudflare Turnstile generates a one-time token to confirm you're not
          automated. We send only the token to Cloudflare, not your form contents.
        </li>
      </ul>

      <h3>From buyers who create an account</h3>
      <ul>
        <li>
          <strong>Authentication</strong> — email address, hashed password (or OAuth
          identifier when you sign in with Google), email-verification status.
        </li>
        <li>
          <strong>Preferences</strong> — display language (EN/ES), currency, theme,
          country/city for localized search defaults.
        </li>
        <li>
          <strong>Activity</strong> — saved searches you opt into, favorited listings,
          recent views (merged from your anonymous cookie when you sign in).
        </li>
        <li>
          <strong>Contact-form submissions you send to agents</strong> — your name,
          email, optional phone, and message text. Forwarded to the agent and stored so
          the agent can respond.
        </li>
        <li>
          <strong>Reviews you write</strong> — rating, body text, the listing you
          referenced, and the email used to verify the review.
        </li>
      </ul>

      <h3>From agents who subscribe</h3>
      <ul>
        <li>
          <strong>Profile</strong> — full name, avatar (uploaded photo), bio,
          specialties, languages spoken, website, WhatsApp number, social-media URLs,
          headquarters city and country.
        </li>
        <li>
          <strong>Listings</strong> — photos, addresses, neighborhood, prices, property
          attributes, descriptions in EN and/or ES. Photos are stored on Cloudflare R2;
          delivery variants on Cloudflare Images.
        </li>
        <li>
          <strong>Sales record</strong> — when a listing is marked as sold or rented:
          closing date, optional closing price, which side you represented (buyer,
          seller, or both).
        </li>
        <li>
          <strong>Lead inbox</strong> — every contact-form submission tied to a listing
          you own.
        </li>
        <li>
          <strong>Subscription state</strong> — Stripe customer ID, plan tier, billing
          period, current period end. We do not see, store, or process your card
          number — Stripe handles that and shares only the metadata above.
        </li>
        <li>
          <strong>Social-channel tokens</strong> (Pro Automation tier only) — OAuth
          tokens for Facebook, Instagram, and WhatsApp Business so we can post listings
          on your behalf. Encrypted at rest. You can revoke any time from the dashboard.
        </li>
      </ul>

      <h2>3. Legal bases (GDPR Art. 6)</h2>
      <ul>
        <li>
          <strong>Contract</strong> — agent subscriptions, listing publication, contact
          forwarding, billing.
        </li>
        <li>
          <strong>Legitimate interest</strong> — anti-abuse (rate-limit, Turnstile,
          honeypot), aggregated analytics, fraud prevention, security logging.
        </li>
        <li>
          <strong>Consent</strong> — saved-search email digests (opt-in via the
          dashboard toggle), any future marketing emails. You can withdraw consent any
          time.
        </li>
        <li>
          <strong>Legal obligation</strong> — retaining billing records as required by
          tax law (typically 7 years).
        </li>
      </ul>

      <h2>4. Who we share data with</h2>
      <p>
        We share data only with processors who help us run the service, all under
        Data Processing Agreements with appropriate safeguards. We do not sell, rent,
        or barter personal data.
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> (Frankfurt, EU) — hosts our database and
          authentication. Row-Level Security policies enforce per-user data isolation
          inside the database.
        </li>
        <li>
          <strong>Cloudflare</strong> (global) — application hosting (Pages, Workers),
          CDN, image delivery, Turnstile bot protection, and KV rate limiting.
        </li>
        <li>
          <strong>Stripe</strong> (US, with EU presence) — subscription billing and
          payment processing. Stripe is PCI-DSS Level 1 certified. Card numbers never
          touch our servers.
        </li>
        <li>
          <strong>Brevo</strong> (France, EU) — transactional emails (welcome,
          password reset, lead notifications, saved-search digests).
        </li>
        <li>
          <strong>Meta (Facebook, Instagram, WhatsApp)</strong> — only when you are a
          Pro Automation subscriber and have explicitly connected the channel; we then
          publish your listing content via Meta's Graph API on your behalf.
        </li>
      </ul>
      <p>
        We disclose data to law enforcement only on receipt of a valid legal request,
        and we attempt to notify the affected user unless we are legally barred from
        doing so.
      </p>

      <h2>5. International transfers</h2>
      <p>
        Some processors (notably Stripe and Cloudflare) operate globally. Where data
        leaves the European Economic Area, we rely on Standard Contractual Clauses
        (SCCs) and the processor's own Transfer Impact Assessments. Our primary
        database is in the EU (Supabase Frankfurt).
      </p>

      <h2>6. How long we keep data</h2>
      <ul>
        <li>
          <strong>Account data</strong> — until you delete the account. Deletion is
          self-service from the dashboard's Profile page.
        </li>
        <li>
          <strong>Active listings</strong> — for the duration the listing is
          published, plus up to 90 days after archival to allow restore.
        </li>
        <li>
          <strong>Lead messages</strong> — 24 months from receipt.
        </li>
        <li>
          <strong>Anonymous visitor events</strong> — 12 months in identifiable form,
          then permanently aggregated.
        </li>
        <li>
          <strong>Stripe billing records</strong> — 7 years to meet tax-record
          obligations.
        </li>
        <li>
          <strong>Operational logs</strong> (request logs, rate-limit counters, error
          traces) — up to 30 days.
        </li>
      </ul>

      <h2>7. Your rights</h2>
      <p>Under GDPR (EU), CCPA (California) and analogous frameworks, you can:</p>
      <ul>
        <li>Access the personal data we hold about you;</li>
        <li>Correct inaccurate data — most fields are self-service in your dashboard;</li>
        <li>
          Delete your account — self-service from the Profile page; cascades to your
          listings, leads, reviews, saved searches, and social tokens. Stripe billing
          records are anonymized but retained where required by law;
        </li>
        <li>Export your data in a portable format — request via privacy@advertisehomes.online;</li>
        <li>Object to processing based on legitimate interests;</li>
        <li>Withdraw consent (notably for email digests) — any time, from the dashboard;</li>
        <li>
          Lodge a complaint with your supervisory authority (e.g., your country's data
          protection agency).
        </li>
      </ul>

      <h2>8. Cookies and similar technologies</h2>
      <p>
        We use a small number of strictly-necessary cookies and one anonymous-visitor
        UUID. We do not use third-party advertising cookies or cross-site trackers.
      </p>
      <ul>
        <li>
          <strong>Auth session cookie</strong> (set when you sign in) — required for
          the dashboard to know who you are.
        </li>
        <li>
          <strong>Locale preference cookie</strong> — remembers EN/ES choice.
        </li>
        <li>
          <strong>Anonymous visitor UUID</strong> — lets us merge your anonymous
          recent-views into your account if you sign up later.
        </li>
        <li>
          <strong>Cloudflare Turnstile cookie</strong> — issued by Cloudflare during
          the bot challenge; expires within minutes of completion.
        </li>
      </ul>

      <h2>9. Security</h2>
      <p>
        HTTPS is enforced everywhere. The database uses Row-Level Security so a user
        can never read another user's data through normal application paths.
        Service-role credentials are scoped to specific server functions and never
        exposed to the browser. Stripe webhooks are signature-verified and idempotent.
        Lead-form abuse is mitigated by a honeypot field, Cloudflare Turnstile, and a
        per-IP rate limit. Where a security incident affects you, we will notify you
        within 72 hours of becoming aware, as required by GDPR Art. 33–34.
      </p>

      <h2>10. Children</h2>
      <p>
        AHO is not intended for users under 16. We do not knowingly collect personal
        data from children. If you believe a child has provided data, contact{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>{' '}
        and we will delete it.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        Material changes will be communicated by email to account holders at least 14
        days before they take effect. Non-material changes (clarifications, processor
        updates) are reflected by updating the &quot;Last updated&quot; date above.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions, requests, or complaints —{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>.
      </p>
    </ArticleShell>
  );
}

function PrivacyEs() {
  return (
    <ArticleShell>
      <h1>Política de Privacidad</h1>
      <p className="text-sm text-helper">Última actualización: {LAST_UPDATED}</p>

      <p>
        Esta Política de Privacidad describe cómo AHO (Advertise Homes Online), que
        opera en <strong>advertisehomes.online</strong>, recopila, utiliza, comparte y
        protege la información de los agentes inmobiliarios que se suscriben para
        publicar anuncios y de los compradores que los exploran y los contactan. Léela
        junto con nuestros <a href="/es/terminos">Términos de Servicio</a>.
      </p>

      <h2>1. Quién es responsable de tus datos</h2>
      <p>
        AHO opera la plataforma. Para preguntas sobre privacidad, escribe a{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>.
        La correspondencia postal está disponible bajo solicitud.
      </p>

      <h2>2. Qué recopilamos y por qué</h2>

      <h3>De cualquiera (navegando sin cuenta)</h3>
      <ul>
        <li>
          <strong>Cookie de visitante anónimo</strong> (un UUID, no rastreable entre
          sitios) — nos permite recordar tus anuncios vistos recientemente y búsquedas
          guardadas entre recargas. Estrictamente funcional, sin perfilado publicitario.
        </li>
        <li>
          <strong>Metadatos de dispositivo/conexión</strong> — dirección IP,
          user-agent y referrer en el momento de una solicitud. Usado para
          limitación de tasa contra abusos y diagnóstico de errores. Los registros se
          conservan hasta 30 días y luego se agregan.
        </li>
        <li>
          <strong>Señal anti-bot</strong> — al enviar un formulario de contacto o
          iniciar sesión, Cloudflare Turnstile genera un token único para confirmar
          que no eres un bot. Solo enviamos el token a Cloudflare, no el contenido del
          formulario.
        </li>
      </ul>

      <h3>De compradores con cuenta</h3>
      <ul>
        <li>
          <strong>Autenticación</strong> — correo, contraseña con hash (o identificador
          OAuth si entras con Google), estado de verificación de email.
        </li>
        <li>
          <strong>Preferencias</strong> — idioma de visualización (EN/ES), moneda,
          tema, país/ciudad para defaults de búsqueda localizada.
        </li>
        <li>
          <strong>Actividad</strong> — búsquedas guardadas a las que te suscribes,
          anuncios marcados como favoritos, vistas recientes (fusionadas desde tu
          cookie anónima al iniciar sesión).
        </li>
        <li>
          <strong>Mensajes que envías a los agentes</strong> — tu nombre, correo,
          teléfono opcional y texto del mensaje. Reenviado al agente y guardado para
          que pueda responder.
        </li>
        <li>
          <strong>Reseñas que escribes</strong> — calificación, texto, anuncio
          referenciado, y el correo usado para verificar la reseña.
        </li>
      </ul>

      <h3>De agentes suscritos</h3>
      <ul>
        <li>
          <strong>Perfil</strong> — nombre completo, avatar, biografía,
          especialidades, idiomas, sitio web, WhatsApp, redes sociales, ciudad y país
          de la oficina principal.
        </li>
        <li>
          <strong>Anuncios</strong> — fotos, direcciones, vecindario, precios, datos
          del inmueble, descripciones en EN y/o ES. Las fotos se guardan en Cloudflare
          R2; las variantes de entrega en Cloudflare Images.
        </li>
        <li>
          <strong>Historial de ventas</strong> — al marcar un anuncio como vendido o
          alquilado: fecha de cierre, precio de cierre opcional, lado representado.
        </li>
        <li>
          <strong>Bandeja de contactos</strong> — cada formulario de contacto
          asociado a un anuncio que posees.
        </li>
        <li>
          <strong>Estado de la suscripción</strong> — ID de cliente Stripe, nivel
          del plan, periodo de facturación, fin del periodo actual. NO vemos, guardamos
          ni procesamos tu número de tarjeta — Stripe lo gestiona y comparte
          únicamente los metadatos anteriores.
        </li>
        <li>
          <strong>Tokens de canales sociales</strong> (solo Pro Automation) — tokens
          OAuth para Facebook, Instagram y WhatsApp Business. Cifrados en reposo.
          Puedes revocar cuando quieras desde el panel.
        </li>
      </ul>

      <h2>3. Bases legales (RGPD Art. 6)</h2>
      <ul>
        <li>
          <strong>Contrato</strong> — suscripciones, publicación de anuncios,
          reenvío de contactos, facturación.
        </li>
        <li>
          <strong>Interés legítimo</strong> — anti-abuso (limitación de tasa,
          Turnstile, honeypot), analítica agregada, prevención de fraude, registro de
          seguridad.
        </li>
        <li>
          <strong>Consentimiento</strong> — resúmenes por correo de búsquedas
          guardadas (opt-in desde el panel) y futuras comunicaciones de marketing.
          Puedes retirar el consentimiento cuando quieras.
        </li>
        <li>
          <strong>Obligación legal</strong> — conservación de registros de
          facturación según ley fiscal (típicamente 7 años).
        </li>
      </ul>

      <h2>4. Con quién compartimos datos</h2>
      <p>
        Compartimos datos solo con procesadores que nos ayudan a operar el servicio,
        bajo Acuerdos de Procesamiento de Datos con salvaguardas apropiadas. NO
        vendemos, alquilamos ni intercambiamos datos personales.
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> (Frankfurt, UE) — base de datos y autenticación.
          Las políticas de Row-Level Security imponen aislamiento por usuario en la
          base de datos.
        </li>
        <li>
          <strong>Cloudflare</strong> (global) — hosting (Pages, Workers), CDN,
          entrega de imágenes, Turnstile y limitación de tasa por KV.
        </li>
        <li>
          <strong>Stripe</strong> (EE.UU., con presencia en UE) — facturación de
          suscripciones y procesamiento de pagos. Certificación PCI-DSS Nivel 1.
        </li>
        <li>
          <strong>Brevo</strong> (Francia, UE) — emails transaccionales (bienvenida,
          recuperación de contraseña, notificaciones de contacto, resúmenes de
          búsquedas).
        </li>
        <li>
          <strong>Meta (Facebook, Instagram, WhatsApp)</strong> — solo si eres
          suscriptor de Pro Automation y has conectado explícitamente el canal;
          publicamos tu contenido vía Graph API en tu nombre.
        </li>
      </ul>
      <p>
        Solo divulgamos datos a fuerzas del orden tras una solicitud legal válida, e
        intentamos notificar al usuario afectado salvo prohibición legal.
      </p>

      <h2>5. Transferencias internacionales</h2>
      <p>
        Algunos procesadores (notablemente Stripe y Cloudflare) operan globalmente.
        Cuando los datos salen del Espacio Económico Europeo, nos basamos en Cláusulas
        Contractuales Tipo (SCC) y las Evaluaciones de Impacto del propio procesador.
        Nuestra base de datos primaria está en la UE (Supabase Frankfurt).
      </p>

      <h2>6. Cuánto tiempo conservamos los datos</h2>
      <ul>
        <li><strong>Datos de cuenta</strong> — hasta que elimines la cuenta (autoservicio desde Perfil).</li>
        <li><strong>Anuncios activos</strong> — durante la publicación, más hasta 90 días tras archivar para permitir restauración.</li>
        <li><strong>Mensajes de contacto</strong> — 24 meses desde la recepción.</li>
        <li><strong>Eventos anónimos de visitantes</strong> — 12 meses identificables, después agregados permanentemente.</li>
        <li><strong>Registros de facturación Stripe</strong> — 7 años para cumplir obligaciones fiscales.</li>
        <li><strong>Logs operacionales</strong> (rate-limit, errores, request) — hasta 30 días.</li>
      </ul>

      <h2>7. Tus derechos</h2>
      <p>Bajo el RGPD, la CCPA (California) y marcos análogos, puedes:</p>
      <ul>
        <li>Acceder a los datos personales que tenemos sobre ti;</li>
        <li>Corregir datos inexactos — la mayoría son autoservicio en el panel;</li>
        <li>
          Eliminar tu cuenta — autoservicio desde Perfil; cascada a anuncios,
          contactos, reseñas, búsquedas guardadas y tokens sociales. Los registros de
          Stripe se anonimizan pero se conservan donde la ley lo exige;
        </li>
        <li>Exportar tus datos en formato portátil — solicítalo en privacy@advertisehomes.online;</li>
        <li>Oponerte al tratamiento basado en interés legítimo;</li>
        <li>Retirar el consentimiento (notablemente para resúmenes por correo) — desde el panel;</li>
        <li>Presentar reclamación ante tu autoridad de control (p. ej. AEPD en España).</li>
      </ul>

      <h2>8. Cookies y tecnologías similares</h2>
      <p>
        Usamos un número reducido de cookies estrictamente necesarias y un UUID
        anónimo. NO usamos cookies publicitarias de terceros ni rastreadores
        cross-site.
      </p>
      <ul>
        <li><strong>Cookie de sesión</strong> (al iniciar sesión) — necesaria para que el panel sepa quién eres.</li>
        <li><strong>Cookie de idioma</strong> — recuerda EN/ES.</li>
        <li><strong>UUID de visitante anónimo</strong> — fusiona vistas recientes anónimas a tu cuenta tras registrarte.</li>
        <li><strong>Cookie de Cloudflare Turnstile</strong> — emitida por Cloudflare durante el desafío anti-bot; expira minutos después.</li>
      </ul>

      <h2>9. Seguridad</h2>
      <p>
        HTTPS forzado en todas partes. La base de datos usa Row-Level Security: un
        usuario nunca puede leer datos de otro por las rutas normales de la
        aplicación. Las credenciales de service-role están limitadas a funciones
        servidor específicas y nunca se exponen al navegador. Los webhooks de Stripe
        están firmados y son idempotentes. Los formularios de contacto se mitigan con
        honeypot, Turnstile y limitación de tasa por IP. Si un incidente de seguridad
        te afecta, te notificaremos en un plazo de 72 horas tras conocerlo, según
        exige el RGPD Art. 33–34.
      </p>

      <h2>10. Menores</h2>
      <p>
        AHO no está dirigido a usuarios menores de 16 años. No recopilamos
        conscientemente datos personales de menores. Si crees que un menor ha
        proporcionado datos, escribe a{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>{' '}
        y los eliminaremos.
      </p>

      <h2>11. Cambios a esta política</h2>
      <p>
        Los cambios materiales se comunicarán por correo a los titulares de cuenta al
        menos 14 días antes de su entrada en vigor. Los cambios no materiales
        (aclaraciones, actualizaciones de procesadores) se reflejan actualizando la
        fecha &quot;Última actualización&quot; arriba.
      </p>

      <h2>12. Contacto</h2>
      <p>
        Preguntas, solicitudes o reclamaciones de privacidad —{' '}
        <a href="mailto:privacy@advertisehomes.online">privacy@advertisehomes.online</a>.
      </p>
    </ArticleShell>
  );
}
