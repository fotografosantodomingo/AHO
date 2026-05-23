import Link from 'next/link';
import { type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

interface Props {
  locale: Locale;
}

const COPY: Record<
  Locale,
  { eyebrow: string; headline: string; sub: string; button: string }
> = {
  en: {
    eyebrow: 'For real estate agents',
    headline: 'Paste your listing URL. Get a full ad campaign in 60 seconds.',
    sub: '9 ad captions + 3 graphics, ready to publish on Facebook, Instagram, and LinkedIn. No signup to see the preview.',
    button: 'Try free audit',
  },
  es: {
    eyebrow: 'Para agentes inmobiliarios',
    headline: 'Pega la URL de tu anuncio. Recibe una campaña completa en 60 segundos.',
    sub: '9 textos publicitarios + 3 gráficos, listos para publicar en Facebook, Instagram y LinkedIn. Sin registro para ver la vista previa.',
    button: 'Probar gratis',
  },
  pl: {
    eyebrow: 'Dla agentów nieruchomości',
    headline: 'Wklej URL swojej oferty. Otrzymaj pełną kampanię reklamową w 60 sekund.',
    sub: '9 tekstów reklamowych + 3 grafiki, gotowe do publikacji na Facebooku, Instagramie i LinkedIn. Bez rejestracji do podglądu.',
    button: 'Wypróbuj bezpłatnie',
  },
  pt: {
    eyebrow: 'Para agentes imobiliários',
    headline: 'Cole o URL do seu anúncio. Obtenha uma campanha completa em 60 segundos.',
    sub: '9 textos publicitários + 3 gráficos, prontos para publicar no Facebook, Instagram e LinkedIn. Sem registo para ver a pré-visualização.',
    button: 'Experimentar grátis',
  },
  de: {
    eyebrow: 'Für Immobilienmakler',
    headline: 'Inserat-URL einfügen. Komplette Anzeigenkampagne in 60 Sekunden.',
    sub: '9 Anzeigentexte + 3 Grafiken, bereit zur Veröffentlichung auf Facebook, Instagram und LinkedIn. Kein Login für die Vorschau.',
    button: 'Kostenlos testen',
  },
  fr: {
    eyebrow: 'Pour les agents immobiliers',
    headline: 'Collez l’URL de votre annonce. Recevez une campagne publicitaire complète en 60 secondes.',
    sub: '9 textes publicitaires + 3 visuels, prêts à publier sur Facebook, Instagram et LinkedIn. Sans inscription pour voir l’aperçu.',
    button: 'Essayer gratuitement',
  },
  it: {
    eyebrow: 'Per agenti immobiliari',
    headline: 'Incolla l’URL del tuo annuncio. Ottieni una campagna pubblicitaria completa in 60 secondi.',
    sub: '9 testi pubblicitari + 3 grafiche, pronti da pubblicare su Facebook, Instagram e LinkedIn. Nessuna registrazione per vedere l’anteprima.',
    button: 'Prova gratis',
  },
};

/**
 * Agent-wedge strip on the homepage. Positioned BETWEEN the buyer-side
 * content (hero search + featured listings + recently viewed) and the
 * Pro Automation ($99/mo) pitch, so the agent who scrolled past the
 * buyer surface hits the LOW-commitment Free Audit funnel before the
 * paid tier pitch. Ascending-commitment funnel: browse → audit (free) →
 * subscribe (paid).
 *
 * Visually consistent with the per-locale Free Audit CTA at the end of
 * every blog article — same emerald accent so visitors recognize the
 * Free Audit branding across surfaces.
 */
export function AgentWedgeStrip({ locale }: Props) {
  const copy = COPY[locale] ?? COPY.en;
  const forAgentsHref = `/${locale}${localePath(locale, '/for-agents')}#free-audit`;

  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 md:p-10 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-emerald-700 dark:text-emerald-300">
              {copy.eyebrow}
            </p>
            <h2 className="mt-3 font-brand text-2xl font-semibold tracking-tight text-slate-900 md:text-[32px] md:leading-[1.15] dark:text-slate-100">
              {copy.headline}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-700 md:text-lg dark:text-slate-300">
              {copy.sub}
            </p>
          </div>
          <Link
            href={forAgentsHref}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700 md:px-7 md:py-3.5"
          >
            {copy.button} →
          </Link>
        </div>
      </div>
    </section>
  );
}
