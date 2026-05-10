'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteRoutingRule,
  setRoutingRuleActive,
} from '@/lib/leads/routing-actions';
import { RoutingRuleForm } from '@/components/leads/routing-rule-form';

/**
 * Per-row actions for the routing-rules table: toggle active, edit
 * (expands inline), delete (with native confirm). Lives on every row
 * so the agency owner can manage rules without leaving the page.
 */

interface OrgMember {
  userId: string;
  fullName: string | null;
  email: string;
}

interface InitialRule {
  id: string;
  name: string;
  priority: number;
  conditions: {
    city?: string;
    country_code?: string;
    language?: string;
    property_type?: string;
  };
  action:
    | { type: 'assign'; assign_to_user_id: string }
    | { type: 'round_robin'; round_robin_user_ids: string[] };
  is_active: boolean;
}

interface Props {
  orgId: string;
  rule: InitialRule;
  members: OrgMember[];
  locale: string;
}

const TXT = {
  en: {
    edit: 'Edit',
    cancel: 'Cancel',
    delete: 'Delete',
    confirmDelete:
      'Delete this routing rule? Future leads matching it will fall back to other rules or the property’s primary agent.',
    activate: 'Activate',
    deactivate: 'Deactivate',
    error: 'Failed',
  },
  es: {
    edit: 'Editar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    confirmDelete:
      '¿Eliminar esta regla de enrutamiento? Los próximos contactos que coincidan caerán en otras reglas o en el agente principal de la propiedad.',
    activate: 'Activar',
    deactivate: 'Desactivar',
    error: 'Falló',
  },
} as const;

function copy(locale: string) {
  return locale === 'es' ? TXT.es : TXT.en;
}

export function RoutingRuleRowActions({ orgId, rule, members, locale }: Props) {
  const t = copy(locale);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onToggle() {
    setError(null);
    startTransition(async () => {
      const result = await setRoutingRuleActive(rule.id, !rule.is_active);
      if (!result.ok) {
        setError(result.errorCode ?? t.error);
        return;
      }
      router.refresh();
    });
  }

  function onDelete() {
    setError(null);
    if (typeof window !== 'undefined' && !window.confirm(t.confirmDelete)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteRoutingRule(rule.id);
      if (!result.ok) {
        setError(result.errorCode ?? t.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={isPending}
          className="inline-flex h-7 items-center rounded-lg border border-border-strong px-2 text-xs disabled:opacity-50"
        >
          {rule.is_active ? t.deactivate : t.activate}
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex h-7 items-center rounded-lg border border-border-strong px-2 text-xs"
        >
          {editing ? t.cancel : t.edit}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending}
          className="inline-flex h-7 items-center rounded-lg border border-red-300 px-2 text-xs text-red-700 disabled:opacity-50 dark:border-red-700/60 dark:text-red-300"
        >
          {t.delete}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-600">
            {error}
          </span>
        )}
      </div>
      {editing && (
        <div className="mt-3 rounded-card border border-border bg-surface p-3 shadow-whisper dark:bg-surface-deep">
          <RoutingRuleForm
            orgId={orgId}
            members={members}
            initial={rule}
            locale={locale}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </>
  );
}
