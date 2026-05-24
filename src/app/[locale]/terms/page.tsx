/* eslint-disable react/no-unescaped-entities -- legal copy uses
   English-natural apostrophes throughout; manually escaping every
   "we're"/"don't"/"you're" ruins readability and diff-noise without
   any rendering benefit (React HTML-encodes them anyway). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildBreadcrumbList, buildGraph, buildWebPage } from '@/lib/seo/jsonld';

export const runtime = 'edge';

const LAST_UPDATED = '2026-05-06';
const SITE_ORIGIN = 'https://advertisehomes.online';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'es' ? 'Términos de Servicio' : 'Terms of Service',
    description:
      locale === 'es'
        ? 'Términos de Servicio de AHO — quién puede usar la plataforma, obligaciones de los agentes y compradores, suscripciones, contenido y limitación de responsabilidad.'
        : 'AHO Terms of Service — who can use the platform, agent and buyer obligations, subscriptions, content, and limitations of liability.',
    alternates: {
      canonical: localePath(locale as Locale, '/terms'),
      languages: {
        en: '/en/terms',
        es: '/es/terminos',
      },
    },
    robots: { index: true, follow: true },
  };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  // JSON-LD: WebPage (legal) + BreadcrumbList. lastReviewed signals
  // freshness — Google ranks legal pages partly on recency.
  const path = locale === 'es' ? '/terminos' : '/terms';
  const pageUrl = `${SITE_ORIGIN}/${locale}${path}`;
  const homeUrl = `${SITE_ORIGIN}/${locale}`;
  const name = locale === 'es' ? 'Términos de Servicio' : 'Terms of Service';
  const graph = buildGraph([
    buildWebPage({
      name,
      url: pageUrl,
      description:
        locale === 'es'
          ? 'Términos de Servicio de AHO — quién puede usar la plataforma, obligaciones de los agentes y compradores, suscripciones, contenido y limitación de responsabilidad.'
          : 'AHO Terms of Service — who can use the platform, agent and buyer obligations, subscriptions, content, and limitations of liability.',
      inLanguage: locale,
      lastReviewed: LAST_UPDATED,
      publisherId: `${SITE_ORIGIN}/#organization`,
      isPartOfId: `${SITE_ORIGIN}/#website`,
    }),
    buildBreadcrumbList([
      { name: 'AHO', url: homeUrl },
      { name, url: pageUrl },
    ]),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <JsonLd node={graph} />
      {locale === 'es' ? <TermsEs /> : <TermsEn />}
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

function TermsEn() {
  return (
    <ArticleShell>
      <h1>Terms of Service</h1>
      <p className="text-sm text-helper">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms govern your use of AHO (Advertise Homes Online) at{' '}
        <strong>advertisehomes.online</strong>. By creating an account, subscribing, or
        publishing a listing, you accept these Terms together with our{' '}
        <Link href="/en/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. The service</h2>
      <p>
        AHO is a real-estate listings marketplace. Buyers browse listings and contact
        agents free of charge. Real-estate agents subscribe to publish listings, manage
        a public profile, receive contact-form leads, and (on the Pro Automation tier)
        distribute listing posts to Facebook, Instagram and WhatsApp Business via
        one-click automation.
      </p>
      <p>
        AHO is <strong>not</strong> a party to any sale, lease, or agency agreement
        between buyers and agents. We provide hosting and tooling; the underlying
        real-estate transaction happens off-platform between the parties.
      </p>

      <h2>2. Eligibility</h2>
      <ul>
        <li>You must be at least 16 to create an account, and at least 18 to subscribe to a paid plan;</li>
        <li>
          Agents represent that they hold any professional license, registration, or
          permit required by their jurisdiction to advertise real estate. AHO does not
          independently verify licensure;
        </li>
        <li>
          You agree to provide accurate registration information and to keep it current.
        </li>
      </ul>

      <h2>3. Accounts and security</h2>
      <p>
        You are responsible for activity on your account. Use a strong, unique
        password. Multi-factor authentication is available and recommended. If you
        suspect unauthorized access, notify us at{' '}
        <a href="mailto:security@advertisehomes.online">security@advertisehomes.online</a>{' '}
        immediately.
      </p>

      <h2>4. Subscriptions, billing, refunds</h2>
      <p>
        Plans are billed via Stripe. Current pricing is shown at{' '}
        <Link href="/en/pricing">/pricing</Link>; the prices on that page at the time of
        purchase are the operative terms.
      </p>
      <ul>
        <li>
          <strong>Trial</strong> — new Agent subscriptions get a 7-day free trial. You
          can cancel at any time during the trial without charge.
        </li>
        <li>
          <strong>Auto-renewal</strong> — subscriptions renew automatically each
          period until cancelled. Cancel any time from the Stripe Customer Portal
          (linked from your dashboard); you keep access through the end of the
          period already paid for.
        </li>
        <li>
          <strong>Plan changes</strong> — upgrades and downgrades apply prorated
          adjustments via Stripe. Refunds are not generally issued for partial periods,
          except where required by consumer-protection law in your jurisdiction.
        </li>
        <li>
          <strong>Taxes</strong> — Stripe Tax computes and collects VAT or sales tax
          where applicable. Prices on the pricing page are exclusive of tax unless
          stated otherwise.
        </li>
        <li>
          <strong>Currency</strong> — all prices are in USD. Stripe converts at the
          time of charge.
        </li>
        <li>
          <strong>Failed payments</strong> — Stripe retries automatically. If retries
          fail, your subscription is paused: existing listings remain visible for 7
          days then are unpublished. They are not deleted; payment recovery restores
          them.
        </li>
      </ul>

      <h2>5. Agent responsibilities — listing content</h2>
      <p>
        Listings are the agent's content. By publishing, you represent and warrant
        that:
      </p>
      <ul>
        <li>
          The listing represents a real, legitimately-listed property — not fake,
          test, or duplicate inventory;
        </li>
        <li>
          You have the authority to advertise the property (owner, listing-side agent,
          or otherwise contractually authorized);
        </li>
        <li>
          Pricing, dimensions, attributes, and descriptions are accurate to the best
          of your knowledge at the time of publication;
        </li>
        <li>
          All photographs are owned by you, licensed for commercial real-estate use,
          or otherwise lawfully usable; AHO does not police photo provenance but will
          act on credible takedown notices;
        </li>
        <li>
          The listing complies with applicable real-estate disclosure rules and Fair
          Housing / non-discrimination laws of the jurisdiction in which the property
          sits;
        </li>
        <li>
          Listings are honestly geolocated. Decoy or wildly inaccurate coordinates may
          result in the listing being unpublished;
        </li>
        <li>
          You will respond to legitimate buyer leads in good faith. Repeated failure
          to respond may result in account review.
        </li>
      </ul>
      <p>
        AHO may unpublish, archive, or delete listings that violate these Terms,
        without refund for fees attributable to the unpublished period.
      </p>

      <h2>6. License you grant AHO</h2>
      <p>
        You retain ownership of your listing content (text, photos, videos, profile
        bio, FAQs). You grant AHO a worldwide, non-exclusive, royalty-free license to
        host, store, transcode, resize, optimize, and publicly display that content
        for the purpose of operating the platform — including in image variants,
        thumbnails, search results, sitemaps, social-distribution posts you authorize,
        and email digests.
      </p>
      <p>
        This license terminates when you delete the content or your account, except
        for cached/backed-up copies that may persist in our systems for up to 30 days
        and for content you have already authorized for social distribution (which
        lives on the third-party platform under that platform's terms).
      </p>

      <h2>7. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Submit fake, illegal, infringing, defamatory, or harassing content;</li>
        <li>
          Use AHO to discriminate against any protected class — including but not
          limited to race, color, religion, sex, sexual orientation, national origin,
          familial status, or disability;
        </li>
        <li>
          Scrape, automate access, or otherwise programmatically extract data beyond
          public sitemaps and the documented APIs;
        </li>
        <li>
          Submit spam, scams, or bait listings; automate contact-form submissions;
          attempt to bypass rate limits, the honeypot field, or the Turnstile bot
          challenge;
        </li>
        <li>
          Reverse-engineer, probe for vulnerabilities outside a coordinated security
          disclosure, or otherwise attack the service;
        </li>
        <li>
          Use the service in a way that violates the laws of your jurisdiction or the
          jurisdiction where the property sits.
        </li>
      </ul>

      <h2>8. Buyer conduct and reviews</h2>
      <p>
        Buyers may contact agents through the platform, save listings, and write
        reviews of agents they have interacted with. Reviews must reflect a genuine
        interaction. AHO moderates reviews and may remove ones that are abusive,
        defamatory, off-topic, or fraudulent. Agents may publicly reply once to each
        review.
      </p>

      <h3>8.1 Chat-widget signup and newsletter consent</h3>
      <p>
        Before you can start a conversation with the AI assistant on a listing or
        agent page, AHO asks for your name and email address and requires you to
        check the consent box. Submitting the form constitutes your agreement to
        these Terms and to AHO's Privacy Policy, AND your explicit consent to be
        added to AHO's newsletter mailing list, which we use for occasional product
        updates and market notes (typically once per month). Your subscription is
        recorded with a timestamp at our email provider, Brevo. You can withdraw
        consent and unsubscribe at any time via the one-click link included in
        every email; unsubscribing removes you from all future newsletter sends
        but does not delete any conversation history with the AHO assistant or
        any contact-form leads you have separately submitted to specific agents.
      </p>

      <h2>9. Social distribution (Pro Automation tier)</h2>
      <p>
        When you connect a Facebook Page, Instagram Business account, or WhatsApp
        Business account, you authorize AHO to publish listing content to that channel
        on your behalf using Meta's Graph API. You remain responsible for compliance
        with each platform's terms and content policies. You can disconnect channels
        any time from the social dashboard; disconnection stops future posts but does
        not retract posts already published.
      </p>

      <h2>10. Copyright and DMCA-style takedown</h2>
      <p>
        If you believe content on AHO infringes your copyright, send a notice to{' '}
        <a href="mailto:legal@advertisehomes.online">legal@advertisehomes.online</a>{' '}
        with: (a) identification of the work, (b) the listing URL or item, (c) your
        contact information, (d) a good-faith statement that the use is unauthorized,
        (e) a statement under penalty of perjury that the information is accurate and
        you are authorized to act for the rights-holder, and (f) your physical or
        electronic signature. We will review and act expeditiously, including
        forwarding the notice to the agent who posted the content.
      </p>

      <h2>11. Disclaimers</h2>
      <p>
        AHO provides the service &quot;as is&quot; and &quot;as available&quot;.
        We do not warrant that listings are accurate, available, or suitable for any
        particular purpose; that agents are licensed, qualified, or capable; or that
        the platform will be uninterrupted or error-free.
      </p>
      <p>
        Real-estate transactions involve substantial financial risk. Always verify
        critical facts (price, dimensions, encumbrances, agent credentials,
        documentation) independently before committing.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, AHO is not liable for indirect,
        incidental, consequential, or punitive damages, or for lost profits, lost
        leads, or business interruption. Our aggregate liability for any claim arising
        from or related to the service is limited to the greater of (a) $100 USD or
        (b) the fees you paid us in the 12 months preceding the event giving rise to
        the claim. Some jurisdictions do not allow these limitations; in those, our
        liability is limited to the smallest amount permitted.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You will defend and indemnify AHO and its operators against claims arising
        from: your listing content, your use of the service, your violation of these
        Terms, or your violation of any applicable law or third-party right.
      </p>

      <h2>14. Termination</h2>
      <p>
        You may terminate at any time by deleting your account from the dashboard. We
        may suspend or terminate your account for material breach of these Terms,
        non-payment, fraud, or extended inactivity. Sections that by their nature
        survive termination (license grants for content already distributed,
        indemnification, limitation of liability, governing law) survive.
      </p>

      <h2>15. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the Dominican Republic, without
        reference to its conflict-of-laws rules. Disputes will be brought in the
        competent courts of Santo Domingo, Distrito Nacional, except that consumers
        retain any rights they have under the law of their country of residence to
        bring suit there. Nothing in this section deprives a consumer of mandatory
        protections under their local law.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        Material changes are communicated by email to account holders at least 14 days
        before they take effect. Continued use after the effective date constitutes
        acceptance. Non-material changes are reflected by updating the &quot;Last
        updated&quot; date above.
      </p>

      <h2>17. Contact</h2>
      <p>
        Legal notices, takedown requests, and Terms questions —{' '}
        <a href="mailto:legal@advertisehomes.online">legal@advertisehomes.online</a>.
        Security disclosures —{' '}
        <a href="mailto:security@advertisehomes.online">security@advertisehomes.online</a>.
      </p>
    </ArticleShell>
  );
}

function TermsEs() {
  return (
    <ArticleShell>
      <h1>Términos de Servicio</h1>
      <p className="text-sm text-helper">Última actualización: {LAST_UPDATED}</p>

      <p>
        Estos Términos rigen tu uso de AHO (Advertise Homes Online) en{' '}
        <strong>advertisehomes.online</strong>. Al crear una cuenta, suscribirte o
        publicar un anuncio, aceptas estos Términos junto con nuestra{' '}
        <Link href="/es/privacidad">Política de Privacidad</Link>.
      </p>

      <h2>1. El servicio</h2>
      <p>
        AHO es un mercado de anuncios inmobiliarios. Los compradores exploran
        anuncios y contactan agentes gratis. Los agentes inmobiliarios se suscriben
        para publicar anuncios, gestionar un perfil público, recibir mensajes de
        contacto y (en el plan Pro Automation) distribuir publicaciones a Facebook,
        Instagram y WhatsApp Business mediante automatización de un clic.
      </p>
      <p>
        AHO <strong>NO</strong> es parte de ningún acuerdo de venta, alquiler o
        agencia entre compradores y agentes. Proporcionamos el alojamiento y las
        herramientas; la transacción inmobiliaria subyacente ocurre fuera de la
        plataforma entre las partes.
      </p>

      <h2>2. Elegibilidad</h2>
      <ul>
        <li>Debes tener al menos 16 años para crear una cuenta y al menos 18 para suscribirte a un plan de pago;</li>
        <li>
          Los agentes declaran tener cualquier licencia, registro o permiso
          profesional exigido en su jurisdicción para publicitar inmuebles. AHO no
          verifica de forma independiente la titulación;
        </li>
        <li>
          Aceptas proporcionar información de registro precisa y mantenerla
          actualizada.
        </li>
      </ul>

      <h2>3. Cuentas y seguridad</h2>
      <p>
        Eres responsable de la actividad de tu cuenta. Usa una contraseña fuerte y
        única. La autenticación multifactor está disponible y recomendada. Si
        sospechas acceso no autorizado, notifícanos en{' '}
        <a href="mailto:security@advertisehomes.online">security@advertisehomes.online</a>{' '}
        de inmediato.
      </p>

      <h2>4. Suscripciones, facturación, reembolsos</h2>
      <p>
        Los planes se facturan vía Stripe. El precio actual se muestra en{' '}
        <Link href="/es/precios">/precios</Link>; los precios en esa página al momento de
        la compra son los operativos.
      </p>
      <ul>
        <li>
          <strong>Prueba gratis</strong> — las nuevas suscripciones de Agente tienen
          7 días de prueba. Puedes cancelar durante la prueba sin cargo.
        </li>
        <li>
          <strong>Renovación automática</strong> — las suscripciones se renuevan
          automáticamente cada periodo hasta que canceles. Cancela cuando quieras
          desde el Portal de Cliente de Stripe (vinculado en el panel); conservas el
          acceso hasta el fin del periodo ya pagado.
        </li>
        <li>
          <strong>Cambios de plan</strong> — las subidas y bajadas aplican ajustes
          prorrateados vía Stripe. No se emiten reembolsos por periodos parciales,
          salvo que la ley de protección al consumidor de tu jurisdicción lo exija.
        </li>
        <li>
          <strong>Impuestos</strong> — Stripe Tax calcula y cobra IVA o impuesto
          sobre ventas según corresponda. Los precios en la página son exclusivos
          de impuestos salvo indicación.
        </li>
        <li><strong>Moneda</strong> — todos los precios en USD. Stripe convierte al cobrar.</li>
        <li>
          <strong>Pagos fallidos</strong> — Stripe reintenta automáticamente. Si
          fallan, tu suscripción se pausa: los anuncios existentes permanecen
          visibles 7 días y luego se despublican. No se eliminan; la recuperación
          del pago los restaura.
        </li>
      </ul>

      <h2>5. Responsabilidades del agente — contenido del anuncio</h2>
      <p>
        Los anuncios son contenido del agente. Al publicar, declaras y garantizas que:
      </p>
      <ul>
        <li>El anuncio representa un inmueble real legítimamente listado — no falso, de prueba ni duplicado;</li>
        <li>Tienes autoridad para publicitar el inmueble (propietario, agente del lado vendedor o autorizado contractualmente);</li>
        <li>Los precios, dimensiones, atributos y descripciones son precisos a tu mejor conocimiento al momento de publicar;</li>
        <li>Las fotografías son tuyas, licenciadas para uso comercial inmobiliario o legalmente utilizables; AHO no audita la procedencia de las fotos pero actúa ante notificaciones creíbles de retirada;</li>
        <li>El anuncio cumple las normas de divulgación y las leyes de Vivienda Justa / no discriminación de la jurisdicción del inmueble;</li>
        <li>Los anuncios están geolocalizados honestamente. Coordenadas señuelo o muy inexactas pueden resultar en despublicación;</li>
        <li>Responderás de buena fe a contactos legítimos. La falta repetida puede resultar en revisión de cuenta.</li>
      </ul>
      <p>
        AHO puede despublicar, archivar o eliminar anuncios que infrinjan estos
        Términos, sin reembolso por las tarifas atribuibles al periodo despublicado.
      </p>

      <h2>6. Licencia que otorgas a AHO</h2>
      <p>
        Conservas la propiedad del contenido de tus anuncios (texto, fotos, videos,
        biografía del perfil, FAQs). Otorgas a AHO una licencia mundial, no
        exclusiva y libre de regalías para alojar, almacenar, transcodificar,
        redimensionar, optimizar y mostrar públicamente ese contenido con el
        propósito de operar la plataforma — incluyendo variantes de imagen,
        miniaturas, resultados de búsqueda, sitemaps, publicaciones de distribución
        social que autorices y resúmenes por correo.
      </p>
      <p>
        Esta licencia termina cuando elimines el contenido o tu cuenta, salvo
        copias en caché o respaldo que pueden persistir hasta 30 días, y el
        contenido ya autorizado para distribución social (que vive en la plataforma
        de terceros bajo sus términos).
      </p>

      <h2>7. Uso aceptable</h2>
      <p>Aceptas no:</p>
      <ul>
        <li>Enviar contenido falso, ilegal, infractor, difamatorio o acosador;</li>
        <li>Usar AHO para discriminar contra cualquier clase protegida — incluyendo raza, color, religión, sexo, orientación sexual, origen nacional, estado familiar o discapacidad;</li>
        <li>Hacer scraping, automatizar acceso o extraer datos de forma programática más allá de los sitemaps públicos y las APIs documentadas;</li>
        <li>Enviar spam, estafas o anuncios señuelo; automatizar formularios de contacto; intentar evadir el limit de tasa, el honeypot o el desafío anti-bot Turnstile;</li>
        <li>Hacer ingeniería inversa, sondear vulnerabilidades fuera de un proceso de divulgación coordinado, o atacar el servicio;</li>
        <li>Usar el servicio infringiendo las leyes de tu jurisdicción o de la del inmueble.</li>
      </ul>

      <h2>8. Conducta del comprador y reseñas</h2>
      <p>
        Los compradores pueden contactar agentes a través de la plataforma, guardar
        anuncios y escribir reseñas de los agentes con los que han interactuado. Las
        reseñas deben reflejar una interacción genuina. AHO modera las reseñas y
        puede eliminar las abusivas, difamatorias, fuera de tema o fraudulentas. Los
        agentes pueden responder públicamente una vez a cada reseña.
      </p>

      <h2>9. Distribución social (nivel Pro Automation)</h2>
      <p>
        Al conectar una página de Facebook, una cuenta Instagram Business o una
        cuenta WhatsApp Business, autorizas a AHO a publicar contenido de anuncios
        en ese canal en tu nombre usando la Graph API de Meta. Sigues siendo
        responsable de cumplir los términos y políticas de contenido de cada
        plataforma. Puedes desconectar canales en cualquier momento desde el panel
        social; la desconexión detiene futuras publicaciones pero no retira las ya
        publicadas.
      </p>

      <h2>10. Derechos de autor y retirada tipo DMCA</h2>
      <p>
        Si crees que contenido en AHO infringe tus derechos de autor, envía una
        notificación a{' '}
        <a href="mailto:legal@advertisehomes.online">legal@advertisehomes.online</a>{' '}
        con: (a) identificación de la obra, (b) la URL del anuncio o el ítem, (c)
        tu información de contacto, (d) una declaración de buena fe de que el uso
        no está autorizado, (e) declaración bajo pena de perjurio de que la
        información es exacta y estás autorizado a actuar por el titular, y (f) tu
        firma física o electrónica. Revisaremos y actuaremos con diligencia,
        incluyendo el reenvío de la notificación al agente que publicó el contenido.
      </p>

      <h2>11. Renuncias</h2>
      <p>
        AHO proporciona el servicio &quot;tal cual&quot; y &quot;según
        disponibilidad&quot;. NO garantizamos que los anuncios sean precisos,
        estén disponibles o sean adecuados para un propósito particular; que los
        agentes estén licenciados, calificados o sean capaces; ni que la plataforma
        sea ininterrumpida o libre de errores.
      </p>
      <p>
        Las transacciones inmobiliarias implican un riesgo financiero sustancial.
        Verifica siempre los hechos críticos (precio, dimensiones, gravámenes,
        credenciales del agente, documentación) de forma independiente antes de
        comprometerte.
      </p>

      <h2>12. Limitación de responsabilidad</h2>
      <p>
        En la máxima medida permitida por la ley, AHO no es responsable por daños
        indirectos, incidentales, consecuenciales o punitivos, ni por lucro cesante,
        contactos perdidos o interrupción del negocio. Nuestra responsabilidad
        agregada por cualquier reclamo derivado del servicio se limita al mayor de
        (a) USD 100 o (b) las tarifas que nos pagaste en los 12 meses anteriores al
        evento. Algunas jurisdicciones no permiten estas limitaciones; en esas,
        nuestra responsabilidad se limita al menor monto permitido.
      </p>

      <h2>13. Indemnización</h2>
      <p>
        Defenderás e indemnizarás a AHO y sus operadores ante reclamaciones que
        surjan de: el contenido de tu anuncio, tu uso del servicio, tu infracción de
        estos Términos o cualquier ley o derecho de terceros aplicable.
      </p>

      <h2>14. Terminación</h2>
      <p>
        Puedes terminar en cualquier momento eliminando tu cuenta desde el panel.
        Podemos suspender o terminar tu cuenta por incumplimiento material, falta de
        pago, fraude o inactividad prolongada. Las secciones que por su naturaleza
        sobreviven la terminación (licencias por contenido ya distribuido,
        indemnización, limitación de responsabilidad, ley aplicable) sobreviven.
      </p>

      <h2>15. Ley aplicable y disputas</h2>
      <p>
        Estos Términos se rigen por las leyes de la República Dominicana, sin
        referencia a sus normas de conflicto de leyes. Las disputas se presentarán
        ante los tribunales competentes de Santo Domingo, Distrito Nacional, salvo
        que los consumidores conserven cualquier derecho que tengan bajo la ley de
        su país de residencia para demandar allí. Nada en esta sección priva a un
        consumidor de protecciones obligatorias bajo su ley local.
      </p>

      <h2>16. Cambios a estos Términos</h2>
      <p>
        Los cambios materiales se comunican por correo a los titulares de cuenta al
        menos 14 días antes de su entrada en vigor. El uso continuado tras la fecha
        efectiva constituye aceptación. Los cambios no materiales se reflejan
        actualizando la fecha &quot;Última actualización&quot; arriba.
      </p>

      <h2>17. Contacto</h2>
      <p>
        Avisos legales, solicitudes de retirada y preguntas sobre Términos —{' '}
        <a href="mailto:legal@advertisehomes.online">legal@advertisehomes.online</a>.
        Divulgaciones de seguridad —{' '}
        <a href="mailto:security@advertisehomes.online">security@advertisehomes.online</a>.
      </p>
    </ArticleShell>
  );
}
