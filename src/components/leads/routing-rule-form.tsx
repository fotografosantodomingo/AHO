'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createRoutingRule,
  updateRoutingRule,
} from '@/lib/leads/routing-actions';
import type { LeadRoutingRuleInput } from '@/lib/leads/routing-schemas';

/**
 * Inline create / edit form for a single routing rule. Lives inside
 * a <details> on the listing page so an agency owner can keep their
 * eyes on existing rules while drafting a new one.
 *
 * The "members" prop is the list of org-member profiles the rule can
 * target. v1 shows only owner/manager/agent roles — analyst/viewer
 * roles can't field leads.
 *
 * Strings inline EN+ES (PL/PT/DE/FR/IT fall back to EN per the
 * dashboard chrome — these are deep-internal admin surfaces, not
 * marketing pages).
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
  members: OrgMember[];
  /** Pass undefined to render in "create" mode. */
  initial?: InitialRule;
  /** Locale governs the inline EN/ES copy. PL/PT/DE/FR/IT → EN. */
  locale: string;
  /** Called after a successful save so the parent can collapse the
   *  details panel. Optional — the form also calls router.refresh()
   *  to surface the new/updated row regardless. */
  onDone?: () => void;
}

const TXT = {
  en: {
    name: 'Rule name',
    namePh: 'e.g. "Mexico City rentals → Maria"',
    priority: 'Priority',
    priorityHelp: 'Higher number wins. Ties resolve by oldest-first.',
    conditionsHeading: 'When a lead matches…',
    city: 'City (exact)',
    countryCode: 'Country code (ISO-2)',
    language: 'Lead language',
    propertyType: 'Property type',
    actionHeading: 'Then assign to…',
    actionAssign: 'A specific agent',
    actionRoundRobin: 'Round-robin across agents',
    assignTo: 'Agent',
    rrSelect: 'Tick agents to include in rotation',
    activeLabel: 'Active',
    save: 'Save rule',
    saving: 'Saving…',
    cancel: 'Cancel',
    error: 'Could not save rule',
    optional: 'Optional',
    rrEmpty: 'Pick at least one agent for the rotation.',
  },
  es: {
    name: 'Nombre de la regla',
    namePh: 'p. ej. "Alquileres CDMX → María"',
    priority: 'Prioridad',
    priorityHelp: 'Gana el número más alto. Empates: la regla más antigua.',
    conditionsHeading: 'Cuando un contacto coincide con…',
    city: 'Ciudad (exacta)',
    countryCode: 'Código país (ISO-2)',
    language: 'Idioma del contacto',
    propertyType: 'Tipo de propiedad',
    actionHeading: 'Asignar a…',
    actionAssign: 'Un agente específico',
    actionRoundRobin: 'Rotación entre agentes',
    assignTo: 'Agente',
    rrSelect: 'Marca los agentes a incluir en la rotación',
    activeLabel: 'Activa',
    save: 'Guardar regla',
    saving: 'Guardando…',
    cancel: 'Cancelar',
    error: 'No se pudo guardar la regla',
    optional: 'Opcional',
    rrEmpty: 'Selecciona al menos un agente para la rotación.',
  },
} as const;

function copy(locale: string) {
  return locale === 'es' ? TXT.es : TXT.en;
}

export function RoutingRuleForm({
  orgId,
  members,
  initial,
  locale,
  onDone,
}: Props) {
  const t = copy(locale);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [priority, setPriority] = useState<number>(initial?.priority ?? 0);
  const [city, setCity] = useState(initial?.conditions.city ?? '');
  const [countryCode, setCountryCode] = useState(
    initial?.conditions.country_code ?? '',
  );
  const [language, setLanguage] = useState(initial?.conditions.language ?? '');
  const [propertyType, setPropertyType] = useState(
    initial?.conditions.property_type ?? '',
  );
  const [actionType, setActionType] = useState<'assign' | 'round_robin'>(
    initial?.action.type ?? 'assign',
  );
  const [assignToUserId, setAssignToUserId] = useState<string>(
    initial?.action.type === 'assign'
      ? initial.action.assign_to_user_id
      : (members[0]?.userId ?? ''),
  );
  const [rrSelected, setRrSelected] = useState<Set<string>>(
    new Set(
      initial?.action.type === 'round_robin'
        ? initial.action.round_robin_user_ids
        : [],
    ),
  );
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);

  function toggleRr(userId: string) {
    setRrSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function buildPayload(): LeadRoutingRuleInput | { error: string } {
    const conditions: Record<string, string> = {};
    if (city.trim()) conditions.city = city.trim();
    if (countryCode.trim()) conditions.country_code = countryCode.trim().toUpperCase();
    if (language.trim()) conditions.language = language.trim().toLowerCase();
    if (propertyType.trim()) conditions.property_type = propertyType.trim();

    const action =
      actionType === 'assign'
        ? { type: 'assign' as const, assign_to_user_id: assignToUserId }
        : {
            type: 'round_robin' as const,
            round_robin_user_ids: Array.from(rrSelected),
          };
    if (
      action.type === 'round_robin' &&
      action.round_robin_user_ids.length === 0
    ) {
      return { error: t.rrEmpty };
    }
    return {
      name: name.trim(),
      priority,
      conditions: conditions as LeadRoutingRuleInput['conditions'],
      action,
      is_active: isActive,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const payload = buildPayload();
    if ('error' in payload) {
      setError(payload.error);
      return;
    }
    startTransition(async () => {
      const result = initial
        ? await updateRoutingRule(initial.id, payload)
        : await createRoutingRule(orgId, payload);
      if (!result.ok) {
        setError(result.errorCode ?? t.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="block font-medium">{t.name}</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePh}
            className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
          />
        </label>
        <label className="block text-sm">
          <span className="block font-medium">{t.priority}</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            min={-1000}
            max={1000}
            step={1}
            className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
          />
          <span className="mt-1 block text-xs text-helper">{t.priorityHelp}</span>
        </label>
      </div>

      <fieldset className="space-y-3 rounded-card border border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-helper">
          {t.conditionsHeading}
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="block font-medium">
              {t.city} <span className="text-helper">({t.optional})</span>
            </span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
            />
          </label>
          <label className="block text-sm">
            <span className="block font-medium">
              {t.countryCode} <span className="text-helper">({t.optional})</span>
            </span>
            <input
              type="text"
              maxLength={2}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
            />
          </label>
          <label className="block text-sm">
            <span className="block font-medium">
              {t.language} <span className="text-helper">({t.optional})</span>
            </span>
            <input
              type="text"
              maxLength={2}
              value={language}
              onChange={(e) => setLanguage(e.target.value.toLowerCase())}
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
            />
          </label>
          <label className="block text-sm">
            <span className="block font-medium">
              {t.propertyType} <span className="text-helper">({t.optional})</span>
            </span>
            <input
              type="text"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              placeholder="apartment / house / condo / land …"
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-card border border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-helper">
          {t.actionHeading}
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="action_type"
              value="assign"
              checked={actionType === 'assign'}
              onChange={() => setActionType('assign')}
            />
            {t.actionAssign}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="action_type"
              value="round_robin"
              checked={actionType === 'round_robin'}
              onChange={() => setActionType('round_robin')}
            />
            {t.actionRoundRobin}
          </label>
        </div>

        {actionType === 'assign' ? (
          <label className="block text-sm">
            <span className="block font-medium">{t.assignTo}</span>
            <select
              value={assignToUserId}
              onChange={(e) => setAssignToUserId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border-strong bg-surface px-2 text-sm shadow-whisper dark:bg-surface-deep"
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName ?? m.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-helper">{t.rrSelect}</p>
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.userId}>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rrSelected.has(m.userId)}
                      onChange={() => toggleRr(m.userId)}
                    />
                    {m.fullName ?? m.email}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        {t.activeLabel}
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-lg bg-action px-3 text-sm font-medium text-white shadow-whisper disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
        >
          {isPending ? t.saving : t.save}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm"
          >
            {t.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
