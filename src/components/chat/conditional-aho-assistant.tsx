'use client';

/**
 * Mount controller for `<AhoAssistantWidget>`. Decides per-pathname
 * whether the AHO platform-side assistant should render, and derives
 * the `surfaceContext` to pass it.
 *
 * Rendered ONCE in `[locale]/layout.tsx`; the widget itself is dumb.
 *
 * Skip rules — the widget MUST NOT render on these surfaces:
 *   - /properties/[slug]    (per-agent AiChatWidget already mounted)
 *   - /agents/[slug]        (per-agent AiChatWidget already mounted)
 *   - /preview/[auditId]    (noindex preview page; no chat needed)
 *   - /admin/*              (admin tools; no public chat)
 *   - /signin / /signup / /forgot-password / /reset-password / /magic-link / /setup-mfa
 *   - /auth/*               (auth callbacks)
 *   - /onboarding/*         (focused conversion flow)
 *   - /reviews/verify/*     (single-purpose token landing)
 *
 * The dashboard itself DOES get the widget — agents commonly ask
 * "how do I…" inside the dashboard, and the AHO Assistant is exactly
 * the right primitive for that.
 */

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { AhoAssistantLocale, AhoAssistantSurface } from './aho-assistant-widget';

// Lazy-load AhoAssistantWidget so its bundle (Web Speech API + chat
// history + 7-locale COPY object + mode picker — ~280 KB minified)
// only ships on pages where the widget actually renders. On /blog
// the skip-check below returns null before the widget mounts, so the
// chunk is never requested. PO Lighthouse run 2026-05-28 saw Perf 70
// on /blog because the widget code was in the initial bundle even
// though it was instantly skipped; this defers it.
const AhoAssistantWidget = dynamic(
  () =>
    import('./aho-assistant-widget').then((m) => ({
      default: m.AhoAssistantWidget,
    })),
  { ssr: false, loading: () => null },
);

interface Props {
  userLocale: AhoAssistantLocale;
  isAuthenticated?: boolean;
}

// Path-segments that, if present anywhere in the pathname, disable
// the widget. Compared after the locale prefix is stripped.
const SKIP_SEGMENTS = [
  // Per-agent <AiChatWidget> retired 2026-05-19 per PO directive — the
  // AHO Assistant is now the SINGLE chat surface site-wide, including
  // on /properties/[slug] and /agents/[slug]. The previous coexistence
  // (per-agent bubble + AHO Assistant on the rest) was confusing for
  // visitors who saw two different bots depending on which page they
  // were on. The skip-entries for 'properties/' / 'propiedades/' /
  // 'agents/' / 'agentes/' that used to live here have been removed.
  // Single-purpose flows below stay skipped (auth surfaces don't need
  // a sales chat overlay):
  'preview/',
  'vista-previa/',
  'admin',
  'signin',
  'iniciar-sesion',
  'signup',
  'registrarse',
  'forgot-password',
  'recuperar-contrasena',
  'reset-password',
  'restablecer-contrasena',
  'magic-link',
  'enlace-magico',
  'setup-mfa',
  'auth/',
  'onboarding/',
  'inicio/bienvenida',
  'reviews/verify/',
  'resenas/verificar/',
  // Editorial blog — readers don't expect a sales chat widget on a
  // long-form article, and stripping the widget here saves ~290 KB
  // of unused first-party JS on those routes (Lighthouse flagged
  // the chunks 3c6892b9 + 7045 + 3949 as unused on /blog/[slug]).
  // Footer + header + JSON-LD still ship; only the floating chat
  // bubble is removed.
  'blog',
];

function detectSurface(pathname: string): AhoAssistantSurface | null {
  // Strip leading "/<locale>/" — locale codes are always 2 chars from
  // our 7-locale set.
  const stripped = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';

  // Skip-list check.
  for (const seg of SKIP_SEGMENTS) {
    if (stripped.startsWith(`/${seg}`) || stripped.includes(`/${seg}`)) {
      return null;
    }
  }

  // Surface-bias mapping. The system-prompt builder uses this to
  // lead with the most relevant content (pricing comparison on
  // /pricing, agent onboarding on /for-agents, etc).
  if (stripped === '/' || stripped === '') return 'home';
  // /sell and its 7 locale slugs (identity-selection page) — and the
  // /sell/private sub-tree which is a product-pitch surface and gets
  // the closest existing bias ('pricing'). The private-subtree check
  // MUST come first so the broader /sell prefix doesn't shadow it.
  const sellPrefixes = [
    '/sell',
    '/vender',
    '/sprzedaj',
    '/verkaufen',
    '/vendre',
    '/vendere',
  ];
  for (const p of sellPrefixes) {
    if (stripped === p || stripped.startsWith(`${p}/`)) {
      if (stripped.startsWith(`${p}/`)) return 'pricing';
      return 'sell';
    }
  }
  // /pricing or /precios
  if (stripped.startsWith('/pricing') || stripped.startsWith('/precios')) return 'pricing';
  // /for-agents and its 7 locale slugs
  if (
    stripped.startsWith('/for-agents') ||
    stripped.startsWith('/para-agentes') ||
    stripped.startsWith('/para-agentes-imobiliarios') ||
    stripped.startsWith('/dla-agentow') ||
    stripped.startsWith('/fuer-makler') ||
    stripped.startsWith('/pour-agents') ||
    stripped.startsWith('/per-agenti')
  ) {
    return 'for-agents';
  }
  if (
    stripped.startsWith('/automation') ||
    stripped.startsWith('/automatizacion') ||
    stripped.startsWith('/automatyzacja') ||
    stripped.startsWith('/automacao') ||
    stripped.startsWith('/automatisierung') ||
    stripped.startsWith('/automatisation') ||
    stripped.startsWith('/automazione')
  ) {
    return 'automation';
  }
  if (
    stripped.startsWith('/save-time') ||
    stripped.startsWith('/ahorra-tiempo') ||
    stripped.startsWith('/oszczedzaj-czas') ||
    stripped.startsWith('/economize-tempo') ||
    stripped.startsWith('/zeit-sparen') ||
    stripped.startsWith('/gagner-du-temps') ||
    stripped.startsWith('/risparmia-tempo')
  ) {
    return 'save-time';
  }
  if (
    stripped.startsWith('/docs') ||
    stripped.startsWith('/documentacion') ||
    stripped.startsWith('/dokumentacja') ||
    stripped.startsWith('/documentacao') ||
    stripped.startsWith('/dokumentation') ||
    stripped.startsWith('/documentation') ||
    stripped.startsWith('/documentazione')
  ) {
    return 'docs';
  }
  // Dashboard (any locale slug — /dashboard, /panel, /tableau-de-bord, /painel)
  if (
    stripped.startsWith('/dashboard') ||
    stripped.startsWith('/panel') ||
    stripped.startsWith('/painel') ||
    stripped.startsWith('/tableau-de-bord')
  ) {
    return 'dashboard';
  }
  // Anything else that survived the skip-list (e.g. /countries,
  // /properties-in/{country}, /investors, /privacy, /terms) gets
  // the 'other' surface — the prompt asks one clarifying question
  // then routes.
  return 'other';
}

export function ConditionalAhoAssistant({ userLocale, isAuthenticated = false }: Props) {
  const pathname = usePathname() ?? '/';
  const surface = detectSurface(pathname);
  if (surface === null) return null;
  return (
    <AhoAssistantWidget
      userLocale={userLocale}
      surfaceContext={surface}
      isAuthenticated={isAuthenticated}
    />
  );
}
