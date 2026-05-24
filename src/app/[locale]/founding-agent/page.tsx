import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBreadcrumbList,
  buildGraph,
  buildWebPage,
} from '@/lib/seo/jsonld';
import {
  FoundingAgentForm,
  type FoundingAgentFormCopy,
} from '@/components/marketing/founding-agent-form';

export const runtime = 'edge';
export const dynamic = 'force-static';

/**
 * /[locale]/founding-agent — Founding 50 program landing page.
 *
 * The dedicated recruitment surface the CEO points cold-outreach
 * links at. Distinct from /for-agents (generic Free Audit funnel) so
 * the applicant lands on the founder-rate pitch DIRECTLY, with the
 * social proof of scarcity ("only 50 spots") + the specific perks
 * (permanent discount, founder access, voice on roadmap) above the
 * application form.
 *
 * No CMS — copy lives inline per locale. EN + ES are full quality
 * (DR-market priority); the other 5 marketing locales (PL/PT/DE/FR/IT)
 * fall back to EN today. Add hand-translated versions when those
 * markets enter the recruitment funnel.
 */

interface PageParams {
  locale: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;
  const copy = PAGE_COPY[typedLocale] ?? PAGE_COPY.en;
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();

  const canonical = `${site}/${typedLocale}${localePath(typedLocale, '/founding-agent')}`;
  const languages: Record<string, string> = {};
  for (const loc of LOCALES) {
    languages[loc] = `${site}/${loc}${localePath(loc, '/founding-agent')}`;
  }
  languages['x-default'] = `${site}/en${localePath('en', '/founding-agent')}`;

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: { canonical, languages },
    openGraph: {
      type: 'website',
      url: canonical,
      title: copy.metaTitle,
      description: copy.metaDescription,
    },
    robots: { index: true, follow: true },
  };
}

export default async function FoundingAgentPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const copy = PAGE_COPY[typedLocale] ?? PAGE_COPY.en!;
  const formCopy = FORM_COPY[typedLocale] ?? FORM_COPY.en!;
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();

  const url = `${site}/${typedLocale}${localePath(typedLocale, '/founding-agent')}`;
  const homeUrl = `${site}/${typedLocale}`;
  const graph = buildGraph([
    buildWebPage({
      url,
      name: copy.metaTitle,
      description: copy.metaDescription,
      inLanguage: typedLocale,
    }),
    buildBreadcrumbList([
      { name: typedLocale === 'es' ? 'Inicio' : 'Home', url: homeUrl },
      { name: copy.eyebrow, url },
    ]),
  ]);

  // Default country pre-fill — Spanish locale defaults to DR (the
  // launch market). Other locales default to the locale's country
  // mapping; EN falls back to DR too since the recruitment pack
  // targets DR primarily.
  const defaultCountryCode = LOCALE_DEFAULT_COUNTRY[typedLocale] ?? 'DO';

  return (
    <>
      <JsonLd node={graph} />
      <main className="bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-emerald-950/20 dark:via-slate-950 dark:to-slate-950">
        <div className="mx-auto max-w-5xl px-4 py-16 md:px-6 md:py-24">
          {/* Hero — eyebrow + headline + scarcity badge + lead copy */}
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-emerald-700 dark:text-emerald-300">
                {copy.eyebrow}
              </p>
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                {copy.scarcityBadge}
              </span>
            </div>
            <h1 className="mt-4 font-brand text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-[56px] md:leading-[1.05]">
              {copy.headline}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700 dark:text-slate-300 md:text-xl">
              {copy.lead}
            </p>
          </div>

          {/* Three-perk grid */}
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {copy.perks.map((perk, i) => (
              <div
                key={i}
                className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm dark:border-emerald-800 dark:bg-slate-900"
              >
                <p className="font-brand text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                  {perk.icon}
                </p>
                <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-100">
                  {perk.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {perk.body}
                </p>
              </div>
            ))}
          </div>

          {/* Form section */}
          <div className="mt-16 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900 md:p-10">
            <div className="mb-8 max-w-2xl">
              <h2 className="font-brand text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-3xl">
                {copy.formHeading}
              </h2>
              <p className="mt-3 text-base text-slate-700 dark:text-slate-300">
                {copy.formSub}
              </p>
            </div>
            <FoundingAgentForm
              locale={typedLocale}
              copy={formCopy}
              defaultCountryCode={defaultCountryCode}
            />
          </div>

          {/* "What happens after you apply" timeline */}
          <div className="mt-16 max-w-3xl">
            <h2 className="font-brand text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 md:text-2xl">
              {copy.timelineHeading}
            </h2>
            <ol className="mt-6 space-y-4 border-l-2 border-emerald-300 pl-6 dark:border-emerald-700">
              {copy.timeline.map((step, i) => (
                <li key={i}>
                  <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    {step.eyebrow}
                  </p>
                  <p className="mt-1 text-base text-slate-900 dark:text-slate-100">
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {/* Founder note — signed, casual tone */}
          <aside className="mt-16 rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/50 md:p-8">
            <p className="text-base italic text-slate-700 dark:text-slate-300 md:text-lg">
              &ldquo;{copy.founderQuote}&rdquo;
            </p>
            <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
              — Michał Babula
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {copy.founderRole}
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}

// ─── Per-locale page copy ─────────────────────────────────────────

interface PageCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  scarcityBadge: string;
  headline: string;
  lead: string;
  perks: Array<{ icon: string; title: string; body: string }>;
  formHeading: string;
  formSub: string;
  timelineHeading: string;
  timeline: Array<{ eyebrow: string; text: string }>;
  founderQuote: string;
  founderRole: string;
}

// Partial — EN + ES are full quality (DR-market priority); the other
// 5 marketing locales fall back to EN via the `?? PAGE_COPY.en!` in
// the page handler. Hand-translate when those markets enter the
// recruitment funnel.
const PAGE_COPY: Partial<Record<Locale, PageCopy>> & { en: PageCopy } = {
  en: {
    metaTitle: 'Founding 50 — AHO',
    metaDescription:
      'AHO is recruiting 50 founding agents. Direct founder access, your voice on the roadmap, a real partnership while we build. Apply in 2 minutes.',
    eyebrow: 'Founding 50 program',
    scarcityBadge: '50 spots only',
    headline: "Help us build AHO. Be one of the first 50.",
    lead:
      "We're recruiting 50 working real-estate agents to use AHO before we open to the public. You get direct WhatsApp access to me (the founder), a real partnership while we build the platform, and your voice on what ships next.",
    perks: [
      {
        icon: '↳',
        title: 'Direct founder access',
        body: "WhatsApp me (Michał) anytime. Founding agents are how I learn what works in your market — your feedback shapes the roadmap.",
      },
      {
        icon: '✦',
        title: 'Your voice on the roadmap',
        body: 'Founding 50 agents vote on the next 3 features. You see the shortlist before anyone else; you decide what ships first.',
      },
      {
        icon: '★',
        title: 'A real partnership',
        body: 'We talk before you sign anything. I want to understand your market, your workflow, your priorities — and then build the right deal for you.',
      },
    ],
    formHeading: 'Apply for one of the 50 spots',
    formSub:
      "Two-minute form. I personally reply within 24-48 hours on WhatsApp. No sales pitch — just a conversation about your market.",
    timelineHeading: 'What happens after you apply',
    timeline: [
      { eyebrow: 'Within minutes', text: 'You get a welcome email from me with what to expect next.' },
      { eyebrow: 'Within 24-48 hours', text: 'I WhatsApp you to introduce myself + ask about your market.' },
      { eyebrow: 'Within a week', text: 'We jump on a 20-minute call. I walk you through AHO live.' },
      { eyebrow: 'When you say yes', text: 'We agree on what makes sense for you and get you onboarded.' },
    ],
    founderQuote:
      "I'm building AHO because I watched solo agents in DR copy-paste the same Facebook caption to 4 groups every time they got a listing. I thought: there's got to be a better way. So I built one. The Founding 50 are the agents who'll help me make it great before we open it up.",
    founderRole: 'Founder, Advertise Homes Online',
  },
  es: {
    metaTitle: 'Founding 50 — AHO',
    metaDescription:
      'AHO está reclutando 50 agentes fundadores. Acceso directo al fundador, tu voz en el roadmap, una verdadera alianza mientras construimos. Aplica en 2 minutos.',
    eyebrow: 'Programa Founding 50',
    scarcityBadge: 'Solo 50 cupos',
    headline: 'Ayúdanos a construir AHO. Sé uno de los primeros 50.',
    lead:
      'Estamos reclutando 50 agentes inmobiliarios activos para usar AHO antes de abrirlo al público. Recibes acceso directo por WhatsApp conmigo (el fundador), una verdadera alianza mientras construimos la plataforma, y tu voz en qué construimos a continuación.',
    perks: [
      {
        icon: '↳',
        title: 'Acceso directo al fundador',
        body: 'Escríbeme por WhatsApp cuando quieras. Los agentes fundadores son cómo aprendo lo que funciona en tu mercado — tu feedback moldea el roadmap.',
      },
      {
        icon: '✦',
        title: 'Tu voz en el roadmap',
        body: 'Los 50 agentes fundadores votan las próximas 3 funciones. Ves la lista antes que nadie; tú decides qué se construye primero.',
      },
      {
        icon: '★',
        title: 'Una alianza real',
        body: 'Conversamos antes de que firmes nada. Quiero entender tu mercado, tu flujo de trabajo, tus prioridades — y entonces armar el acuerdo correcto para ti.',
      },
    ],
    formHeading: 'Aplica a uno de los 50 cupos',
    formSub:
      'Formulario de dos minutos. Respondo personalmente en 24-48 horas por WhatsApp. Sin presión de venta — solo una conversación sobre tu mercado.',
    timelineHeading: 'Qué pasa después de aplicar',
    timeline: [
      { eyebrow: 'En minutos', text: 'Recibes un correo de bienvenida mío con qué esperar a continuación.' },
      { eyebrow: 'En 24-48 horas', text: 'Te escribo por WhatsApp para presentarme y preguntarte sobre tu mercado.' },
      { eyebrow: 'En una semana', text: 'Hacemos una llamada de 20 minutos. Te muestro AHO en vivo.' },
      { eyebrow: 'Cuando digas sí', text: 'Acordamos lo que tiene sentido para ti y te integramos.' },
    ],
    founderQuote:
      'Construyo AHO porque vi a agentes solos en RD copiar y pegar el mismo texto de Facebook a 4 grupos cada vez que conseguían una propiedad. Pensé: tiene que haber una mejor manera. Así que la construí. Los Founding 50 son los agentes que me ayudarán a perfeccionarla antes de abrirla.',
    founderRole: 'Fundador, Advertise Homes Online',
  },
};

// Mirror the same partial-with-en-guaranteed pattern for form copy.
const FORM_COPY: Partial<Record<Locale, FoundingAgentFormCopy>> & {
  en: FoundingAgentFormCopy;
} = {
  en: {
    labelFullName: 'Full name',
    labelEmail: 'Email',
    labelWhatsApp: 'WhatsApp number',
    hintWhatsApp: 'Optional but strongly preferred — this is how I reach you.',
    labelCity: 'City',
    placeholderCity: 'e.g. Santo Domingo',
    labelCountry: 'Country',
    labelPortfolio: 'Listings portfolio URL',
    hintPortfolio: 'Optional. Your website, realtor.com / idealista / otodom profile, anything that shows your active work.',
    labelMessage: 'Anything you want to tell me',
    hintMessage: 'Optional. The 1 thing that frustrates you most about marketing listings today is what I most want to hear.',
    submitButton: 'Apply for a Founding 50 spot',
    submitLoading: 'Submitting',
    trustNote:
      'We never spam, sell your data, or auto-enroll you in anything. The email + WhatsApp are only used for this conversation.',
    successHeading: 'Got it. Thanks for applying.',
    successBody:
      "Check your inbox for the welcome email. I'll WhatsApp you within 24-48 hours.",
    successAlready: "You're already on the list.",
    successAlreadyBody:
      "I see your earlier application. Check the welcome email or — if you didn't get it — reply to info@advertisehomes.online and I'll re-send.",
    errorRateLimited:
      'Too many applications from your network in the last 24 hours. Try again later or email info@advertisehomes.online directly.',
    errorInvalid:
      "Some of the fields didn't validate. Check the email + city + country fields.",
    errorGeneric:
      'Something went wrong on our side. Try again, or email info@advertisehomes.online.',
    country_DO: 'Dominican Republic',
    country_ES: 'Spain',
    country_MX: 'Mexico',
    country_CO: 'Colombia',
    country_AR: 'Argentina',
    country_US: 'United States',
    country_PL: 'Poland',
    country_PT: 'Portugal',
    country_DE: 'Germany',
    country_FR: 'France',
    country_IT: 'Italy',
  },
  es: {
    labelFullName: 'Nombre completo',
    labelEmail: 'Correo electrónico',
    labelWhatsApp: 'Número de WhatsApp',
    hintWhatsApp: 'Opcional pero muy preferido — así te contacto.',
    labelCity: 'Ciudad',
    placeholderCity: 'ej. Santo Domingo',
    labelCountry: 'País',
    labelPortfolio: 'URL de tu portafolio de propiedades',
    hintPortfolio: 'Opcional. Tu sitio web, perfil de idealista / dominicanproperties / otra plataforma, cualquier cosa que muestre tu trabajo activo.',
    labelMessage: 'Lo que quieras contarme',
    hintMessage: 'Opcional. Lo que más te frustra del marketing de propiedades hoy es lo que más me interesa escuchar.',
    submitButton: 'Aplicar a un cupo Founding 50',
    submitLoading: 'Enviando',
    trustNote:
      'Nunca enviamos spam, no vendemos tus datos, ni te inscribimos automáticamente en nada. El correo y WhatsApp se usan solo para esta conversación.',
    successHeading: 'Recibido. Gracias por aplicar.',
    successBody:
      'Revisa tu correo para el mensaje de bienvenida. Te contacto por WhatsApp en 24-48 horas.',
    successAlready: 'Ya estás en la lista.',
    successAlreadyBody:
      'Veo tu aplicación anterior. Revisa el correo de bienvenida o — si no lo recibiste — responde a info@advertisehomes.online y lo reenvío.',
    errorRateLimited:
      'Demasiadas aplicaciones desde tu red en las últimas 24 horas. Inténtalo más tarde o escribe directamente a info@advertisehomes.online.',
    errorInvalid:
      'Algunos campos no validaron. Revisa el correo, ciudad y país.',
    errorGeneric:
      'Algo salió mal de nuestro lado. Inténtalo de nuevo o escríbenos a info@advertisehomes.online.',
    country_DO: 'República Dominicana',
    country_ES: 'España',
    country_MX: 'México',
    country_CO: 'Colombia',
    country_AR: 'Argentina',
    country_US: 'Estados Unidos',
    country_PL: 'Polonia',
    country_PT: 'Portugal',
    country_DE: 'Alemania',
    country_FR: 'Francia',
    country_IT: 'Italia',
  },
};

// Pre-fill the country dropdown based on the visitor's locale.
// DR-priority: EN + ES both default to DO since the launch market
// is DR. Other locales default to their country.
const LOCALE_DEFAULT_COUNTRY: Record<Locale, string> = {
  en: 'DO',
  es: 'DO',
  pl: 'PL',
  pt: 'PT',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
};
