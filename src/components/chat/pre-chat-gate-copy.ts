/**
 * Localized strings for the pre-chat gate. Shared by:
 *   - <AiChatWidget>           (/properties/[slug] + /agents/[slug])
 *   - <AhoAssistantWidget>     (platform-Q&A on /, /pricing, /sell, etc.)
 *
 * Lives in its own module so adding a new locale or rewording the
 * consent paragraph happens once. The {terms} / {privacy} tokens are
 * replaced with anchor tags by `<PreChatGate>` at render time.
 *
 * Keep in sync with the legal copy at /[locale]/privacy + /[locale]/terms.
 * If you change consentText materially (not just typo fixes), bump
 * the `STORAGE_KEY` in pre-chat-gate.tsx to invalidate old consents
 * and force everyone to re-accept the new text.
 */

import type { PreChatGateProps } from './pre-chat-gate';

export type GateLocale = 'en' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

export const GATE_COPY: Record<GateLocale, PreChatGateProps['copy']> = {
  en: {
    heading: 'Before we start',
    sub: 'Tell us who you are so we can follow up if the conversation leads somewhere. You\'ll be added to AHO\'s newsletter; unsubscribe any time.',
    nameLabel: 'Name',
    namePlaceholder: 'Your full name',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    consentText:
      'I accept the {terms} and the {privacy}, and I agree to receive occasional newsletter updates from AHO. I can unsubscribe at any time.',
    consentTermsLabel: 'terms of service',
    consentPrivacyLabel: 'privacy policy',
    submit: 'Start chat',
    submitting: 'Starting…',
    errorEmail: 'Enter a valid email address.',
    errorName: 'Tell us your name.',
    errorConsent: 'Please accept the terms before continuing.',
    errorNetwork: 'Could not subscribe. Try again in a moment.',
  },
  es: {
    heading: 'Antes de empezar',
    sub: 'Cuéntanos quién eres para que podamos contactarte si la conversación lo amerita. Te añadiremos al boletín de AHO; puedes darte de baja cuando quieras.',
    nameLabel: 'Nombre',
    namePlaceholder: 'Tu nombre completo',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    consentText:
      'Acepto los {terms} y la {privacy}, y autorizo recibir comunicaciones ocasionales del boletín de AHO. Puedo darme de baja cuando quiera.',
    consentTermsLabel: 'términos del servicio',
    consentPrivacyLabel: 'política de privacidad',
    submit: 'Empezar chat',
    submitting: 'Iniciando…',
    errorEmail: 'Introduce un correo electrónico válido.',
    errorName: 'Dinos cómo te llamas.',
    errorConsent: 'Acepta los términos antes de continuar.',
    errorNetwork: 'No se pudo suscribir. Inténtalo de nuevo en un momento.',
  },
  pl: {
    heading: 'Zanim zaczniemy',
    sub: 'Powiedz, kim jesteś — skontaktujemy się, jeśli rozmowa do czegoś doprowadzi. Dodamy Cię do newslettera AHO; możesz wypisać się w każdej chwili.',
    nameLabel: 'Imię',
    namePlaceholder: 'Twoje imię i nazwisko',
    emailLabel: 'E-mail',
    emailPlaceholder: 'ty@przyklad.com',
    consentText:
      'Akceptuję {terms} oraz {privacy} i wyrażam zgodę na okresowe wiadomości z newslettera AHO. Mogę wypisać się w każdej chwili.',
    consentTermsLabel: 'regulamin',
    consentPrivacyLabel: 'politykę prywatności',
    submit: 'Rozpocznij czat',
    submitting: 'Łączenie…',
    errorEmail: 'Wpisz poprawny adres e-mail.',
    errorName: 'Powiedz, jak masz na imię.',
    errorConsent: 'Zaakceptuj regulamin, aby kontynuować.',
    errorNetwork: 'Nie udało się zapisać. Spróbuj ponownie za chwilę.',
  },
  pt: {
    heading: 'Antes de começar',
    sub: 'Diga quem é você para entrarmos em contato se a conversa exigir. Você será adicionado à newsletter da AHO; pode cancelar a inscrição a qualquer momento.',
    nameLabel: 'Nome',
    namePlaceholder: 'Seu nome completo',
    emailLabel: 'E-mail',
    emailPlaceholder: 'voce@exemplo.com',
    consentText:
      'Aceito os {terms} e a {privacy}, e autorizo o recebimento ocasional de comunicações da newsletter AHO. Posso cancelar a inscrição a qualquer momento.',
    consentTermsLabel: 'termos de serviço',
    consentPrivacyLabel: 'política de privacidade',
    submit: 'Começar chat',
    submitting: 'Iniciando…',
    errorEmail: 'Informe um e-mail válido.',
    errorName: 'Diga seu nome.',
    errorConsent: 'Aceite os termos para continuar.',
    errorNetwork: 'Não foi possível inscrever. Tente novamente em instantes.',
  },
  de: {
    heading: 'Bevor wir starten',
    sub: 'Sagen Sie uns, wer Sie sind, damit wir uns melden können, falls das Gespräch weitergeht. Sie werden zum AHO-Newsletter hinzugefügt; jederzeit abbestellbar.',
    nameLabel: 'Name',
    namePlaceholder: 'Ihr vollständiger Name',
    emailLabel: 'E-Mail',
    emailPlaceholder: 'sie@beispiel.com',
    consentText:
      'Ich akzeptiere die {terms} und die {privacy} und erkläre mich mit gelegentlichen Newsletter-Updates von AHO einverstanden. Ich kann mich jederzeit abmelden.',
    consentTermsLabel: 'Nutzungsbedingungen',
    consentPrivacyLabel: 'Datenschutzerklärung',
    submit: 'Chat starten',
    submitting: 'Wird gestartet…',
    errorEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
    errorName: 'Bitte nennen Sie Ihren Namen.',
    errorConsent: 'Bitte akzeptieren Sie die Bedingungen, um fortzufahren.',
    errorNetwork: 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
  },
  fr: {
    heading: 'Avant de commencer',
    sub: 'Dites-nous qui vous êtes pour que nous puissions vous recontacter si la conversation l\'exige. Vous serez ajouté à la newsletter AHO ; désinscription à tout moment.',
    nameLabel: 'Nom',
    namePlaceholder: 'Votre nom complet',
    emailLabel: 'E-mail',
    emailPlaceholder: 'vous@exemple.com',
    consentText:
      'J\'accepte les {terms} et la {privacy}, et j\'autorise la réception occasionnelle de la newsletter AHO. Je peux me désinscrire à tout moment.',
    consentTermsLabel: 'conditions d\'utilisation',
    consentPrivacyLabel: 'politique de confidentialité',
    submit: 'Démarrer le chat',
    submitting: 'Démarrage…',
    errorEmail: 'Saisissez une adresse e-mail valide.',
    errorName: 'Indiquez votre nom.',
    errorConsent: 'Veuillez accepter les conditions pour continuer.',
    errorNetwork: 'Inscription impossible. Réessayez dans un instant.',
  },
  it: {
    heading: 'Prima di iniziare',
    sub: 'Dicci chi sei così possiamo ricontattarti se la conversazione lo richiede. Sarai aggiunto alla newsletter AHO; disiscrizione in qualsiasi momento.',
    nameLabel: 'Nome',
    namePlaceholder: 'Il tuo nome completo',
    emailLabel: 'E-mail',
    emailPlaceholder: 'tu@esempio.com',
    consentText:
      'Accetto i {terms} e la {privacy}, e autorizzo a ricevere occasionalmente la newsletter di AHO. Posso disiscrivermi in qualsiasi momento.',
    consentTermsLabel: 'termini di servizio',
    consentPrivacyLabel: 'informativa sulla privacy',
    submit: 'Inizia chat',
    submitting: 'Avvio…',
    errorEmail: 'Inserisci un indirizzo e-mail valido.',
    errorName: 'Dicci come ti chiami.',
    errorConsent: 'Accetta i termini per continuare.',
    errorNetwork: 'Iscrizione non riuscita. Riprova tra poco.',
  },
};
