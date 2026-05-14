# Frontend — Admin pages, service, and i18n

What this folder ships:

```
frontend/
├── src/
│   ├── pages/admin/email/
│   │   ├── EmailDashboardPage.jsx     KPI tiles + delivered/opened/clicked chart
│   │   ├── EmailContactsPage.jsx      CRUD + segment filter + bulk import
│   │   ├── EmailCampaignsPage.jsx     List + duplicate + delete
│   │   ├── EmailComposerPage.jsx      WYSIWYG-ish composer (rich textarea, preview, test send)
│   │   └── EmailTemplatesPage.jsx     Per-type/lang editor for transactional order emails
│   ├── services/
│   │   ├── EmailMarketingService.js   Thin client → Worker POST /email/send
│   │   └── NewsletterService.js       Public newsletter signup + welcome trigger
│   ├── config/
│   │   └── emailWorker.js             EMAIL_WORKER_BASE_URL constant
│   ├── components/
│   │   └── NewsletterSignup.jsx       Reusable footer/hero/default signup form
│   └── i18n/locales/
│       ├── es/
│       │   ├── adminEmailDashboard.json
│       │   ├── adminEmailContacts.json
│       │   ├── adminEmailCampaigns.json
│       │   ├── adminEmailComposer.json
│       │   ├── adminEmailTemplates.json
│       │   └── newsletter.json
│       └── en/ (same 6 namespaces, English copy)
```

## NPM dependencies

The pages assume these are already installed in your project (Kibay versions
shown — anything in the same major should work):

| Package                   | Version   | Used in                                  |
| ------------------------- | --------- | ---------------------------------------- |
| `react`                   | ^18 or 19 | All                                      |
| `react-router-dom`        | ^7.1.1    | `<Link>` for back buttons                |
| `react-i18next` + `i18next` | ^15 / ^23 | All admin pages, NewsletterSignup        |
| `react-helmet`            | ^6.x      | `<Helmet>` for page titles               |
| `framer-motion`           | ^11.15.0  | `m.div` entrance animations              |
| `lucide-react`            | ^0.469.0  | Icons (Mail, Users, Send, etc)           |
| `recharts`                | ^3.8.1    | Dashboard delivered/opened/clicked chart |
| `sonner`                  | ^2.0.7    | Toasts on send/save                      |
| `@supabase/supabase-js`   | ^2.103.3  | DB reads from admin pages                |

## Required parent-project provisions

The pages import these — they must exist in your project before the pages
will compile. (They're things Kibay already has; we don't bundle them because
they're project-shaped, not feature-shaped.)

| Import                          | What it is                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `@/lib/customSupabaseClient`    | Default `createClient(...)` wrapped to your liking. Must export `{ supabase }`.       |
| `@/components/ui/button`        | shadcn/ui Button component (`<Button variant=...>`).                                  |
| `@/components/ui/input`         | shadcn/ui Input.                                                                       |
| `@/components/ui/use-toast`     | shadcn/ui toast hook used by NewsletterSignup.                                        |
| `@/lib/utils`                   | Must export `cn(...classes)` (clsx + tailwind-merge wrapper).                          |
| `<ProtectedAdminRoute>`         | Your existing wrapper that checks `auth.uid()` against admin role and redirects.      |

If your project doesn't use shadcn/ui, swap the `<Button>` / `<Input>` imports
for your own components — function signature is just `className` + `disabled`
+ standard HTML props.

## Wiring routes

```jsx
// src/App.jsx (Kibay does it lazily — recommended for admin pages)
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import ProtectedAdminRoute from '@/components/ProtectedAdminRoute';

const EmailDashboardPage = lazy(() => import('@/pages/admin/email/EmailDashboardPage'));
const EmailContactsPage   = lazy(() => import('@/pages/admin/email/EmailContactsPage'));
const EmailCampaignsPage  = lazy(() => import('@/pages/admin/email/EmailCampaignsPage'));
const EmailComposerPage   = lazy(() => import('@/pages/admin/email/EmailComposerPage'));
const EmailTemplatesPage  = lazy(() => import('@/pages/admin/email/EmailTemplatesPage'));

<Suspense fallback={<div>Loading...</div>}>
  <Routes>
    {/* ...your other routes */}
    <Route path="/admin/email"           element={<ProtectedAdminRoute><EmailDashboardPage /></ProtectedAdminRoute>} />
    <Route path="/admin/email/contacts"  element={<ProtectedAdminRoute><EmailContactsPage  /></ProtectedAdminRoute>} />
    <Route path="/admin/email/campaigns" element={<ProtectedAdminRoute><EmailCampaignsPage /></ProtectedAdminRoute>} />
    <Route path="/admin/email/compose"   element={<ProtectedAdminRoute><EmailComposerPage  /></ProtectedAdminRoute>} />
    <Route path="/admin/email/compose/:campaignId" element={<ProtectedAdminRoute><EmailComposerPage /></ProtectedAdminRoute>} />
    <Route path="/admin/email/templates" element={<ProtectedAdminRoute><EmailTemplatesPage /></ProtectedAdminRoute>} />
  </Routes>
</Suspense>
```

## Wiring i18n

If you're using `react-i18next` with one resources object:

```js
// src/i18n/index.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Existing namespaces...
import esAdminEmailDashboard  from './locales/es/adminEmailDashboard.json';
import esAdminEmailContacts   from './locales/es/adminEmailContacts.json';
import esAdminEmailCampaigns  from './locales/es/adminEmailCampaigns.json';
import esAdminEmailComposer   from './locales/es/adminEmailComposer.json';
import esAdminEmailTemplates  from './locales/es/adminEmailTemplates.json';
import esNewsletter           from './locales/es/newsletter.json';
import enAdminEmailDashboard  from './locales/en/adminEmailDashboard.json';
import enAdminEmailContacts   from './locales/en/adminEmailContacts.json';
import enAdminEmailCampaigns  from './locales/en/adminEmailCampaigns.json';
import enAdminEmailComposer   from './locales/en/adminEmailComposer.json';
import enAdminEmailTemplates  from './locales/en/adminEmailTemplates.json';
import enNewsletter           from './locales/en/newsletter.json';

i18n
  .use(initReactI18next)
  .init({
    fallbackLng: 'es',
    ns: [
      // ...your existing namespaces
      'adminEmailDashboard',
      'adminEmailContacts',
      'adminEmailCampaigns',
      'adminEmailComposer',
      'adminEmailTemplates',
      'newsletter',
    ],
    resources: {
      es: {
        // ...existing
        adminEmailDashboard:  esAdminEmailDashboard,
        adminEmailContacts:   esAdminEmailContacts,
        adminEmailCampaigns:  esAdminEmailCampaigns,
        adminEmailComposer:   esAdminEmailComposer,
        adminEmailTemplates:  esAdminEmailTemplates,
        newsletter:           esNewsletter,
      },
      en: {
        // ...existing
        adminEmailDashboard:  enAdminEmailDashboard,
        adminEmailContacts:   enAdminEmailContacts,
        adminEmailCampaigns:  enAdminEmailCampaigns,
        adminEmailComposer:   enAdminEmailComposer,
        adminEmailTemplates:  enAdminEmailTemplates,
        newsletter:           enNewsletter,
      },
    },
  });
```

## Wiring Navigation

The pages don't ship a parent nav. Add links wherever your admin shell lives.
Kibay's `Navigation.jsx` has an "Email Marketing" section in the admin
dropdown that mirrors the 5 routes above. Replicate something like:

```jsx
{isAdmin && (
  <div className="admin-section">
    <Link to="/admin/email">Dashboard</Link>
    <Link to="/admin/email/contacts">Contacts</Link>
    <Link to="/admin/email/campaigns">Campaigns</Link>
    <Link to="/admin/email/compose">Compose</Link>
    <Link to="/admin/email/templates">Templates</Link>
  </div>
)}
```

## Configuration

`src/config/emailWorker.js` has the Worker URL constant:

```js
export const EMAIL_WORKER_BASE_URL = 'https://kibay-drive-pipeline.sweet-math-09d2.workers.dev';
```

Change this to your Worker's URL after deploy. The service file uses it for
both `POST /email/send` (campaign send) and `POST /newsletter/welcome` (after
signup).

## Brand-genericization

Most user-facing copy in the admin pages is already in i18n JSON — so for
copy changes, edit the JSON, not the JSX. Things that AREN'T in i18n and
need a code edit:

| File                     | What's hardcoded                                       |
| ------------------------ | ------------------------------------------------------ |
| `NewsletterSignup.jsx`   | Gold colour `#D4A574` (Kibay accent) used 4x.           |
| `EmailContactsPage.jsx`  | Seed contact display + UI gold accent.                 |
| All admin pages          | Page titles via `<Helmet>` say "Kibay" — search/replace. |

The `EMAIL_WORKER_BASE_URL` constant in `config/emailWorker.js` is the only
deploy-target reference.

## What's NOT bundled

- Your auth wrapper (`ProtectedAdminRoute`) — too project-specific.
- `Navigation.jsx` itself — depends on your shell.
- shadcn/ui base components.
- The Stripe webhook that fires `send-order-email` on payment success.
- Top-level `App.jsx` — you wire routes yourself per the snippet above.
