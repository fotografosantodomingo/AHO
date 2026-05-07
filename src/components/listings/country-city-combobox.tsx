'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchIndexEntry } from '@/lib/listings/countries';

/**
 * Combobox typeahead for the /countries page. Searches the flat
 * country+city index server-rendered into the page; navigates to the
 * country or city landing on selection.
 *
 * Match scoring (in `match`) — diacritic-folded, case-insensitive:
 *   3 = exact match on display name
 *   2 = display name starts with query
 *   1 = display name contains query as a word boundary or anywhere in
 *       the country code
 *   0 = no match
 * Ties broken by listing count (desc).
 *
 * Accessibility — implements the WAI-ARIA 1.2 combobox pattern:
 *   - input has role="combobox", aria-expanded, aria-controls, aria-activedescendant
 *   - listbox has role="listbox"
 *   - each option has role="option" + a stable id for activedescendant
 *   - ↓ next, ↑ prev, Enter selects, Esc closes, Tab closes (lets focus move)
 */

const MAX_RESULTS = 12;

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

interface ScoredEntry {
  entry: SearchIndexEntry;
  score: number;
}

function scoreEntry(entry: SearchIndexEntry, q: string): number {
  if (!q) return 0;
  const name = fold(entry.displayName);
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  // Word-boundary match — "san" hits "Santo Domingo" but not "Sansibar"
  // would still hit; we keep it permissive so partial typing works.
  if (name.includes(q)) return 1;
  if (entry.kind === 'country' && entry.countryCode.toLowerCase() === q) {
    return 2;
  }
  return 0;
}

interface CountryCityComboboxProps {
  entries: SearchIndexEntry[];
  placeholder: string;
  ariaLabel: string;
  noResultsLabel: string;
  countriesGroupLabel: string;
  citiesGroupLabel: string;
  listingsCountSingular: string;
  listingsCountPlural: string;
}

export function CountryCityCombobox({
  entries,
  placeholder,
  ariaLabel,
  noResultsLabel,
  countriesGroupLabel,
  citiesGroupLabel,
  listingsCountSingular,
  listingsCountPlural,
}: CountryCityComboboxProps) {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const results = useMemo<ScoredEntry[]>(() => {
    const q = fold(query.trim());
    if (!q) return [];
    const scored: ScoredEntry[] = [];
    for (const entry of entries) {
      const score = scoreEntry(entry, q);
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.listingCount - a.entry.listingCount;
    });
    return scored.slice(0, MAX_RESULTS);
  }, [entries, query]);

  const grouped = useMemo(() => {
    const countries: ScoredEntry[] = [];
    const cities: ScoredEntry[] = [];
    for (const r of results) {
      if (r.entry.kind === 'country') countries.push(r);
      else cities.push(r);
    }
    return { countries, cities };
  }, [results]);

  // Flat list of result entries in render order — used by keyboard nav
  // so the index maps directly to the visible row.
  const flat = useMemo(
    () => [...grouped.countries, ...grouped.cities],
    [grouped],
  );

  function commit(entry: SearchIndexEntry): void {
    setOpen(false);
    setActiveIndex(-1);
    router.push(entry.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= flat.length ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 < 0 ? flat.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      const target = activeIndex >= 0 ? flat[activeIndex] : flat[0];
      if (target) {
        e.preventDefault();
        commit(target.entry);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const listboxId = `${id}-listbox`;
  const activeOptionId =
    activeIndex >= 0 && flat[activeIndex]
      ? `${id}-opt-${flat[activeIndex].entry.kind}-${
          flat[activeIndex].entry.kind === 'country'
            ? flat[activeIndex].entry.countryCode
            : `${flat[activeIndex].entry.countryCode}-${
                (flat[activeIndex].entry as { citySlug: string }).citySlug
              }`
        }`
      : undefined;

  function countLabel(n: number): string {
    return `${n} ${n === 1 ? listingsCountSingular : listingsCountPlural}`;
  }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open && results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        onBlur={() => {
          // Defer close so a click on a listbox item still registers.
          setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        className="block w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-base shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
      />
      {open && query.trim() !== '' && (
        <div
          className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg dark:bg-surface-deep"
        >
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-helper">{noResultsLabel}</p>
          ) : (
            <ul role="listbox" id={listboxId} className="py-1">
              {grouped.countries.length > 0 && (
                <>
                  <li
                    role="presentation"
                    className="px-4 pt-2 pb-1 font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper"
                  >
                    {countriesGroupLabel}
                  </li>
                  {grouped.countries.map(({ entry }, i) => {
                    const optId = `${id}-opt-country-${
                      (entry as { countryCode: string }).countryCode
                    }`;
                    const isActive = activeIndex === i;
                    return (
                      <li
                        key={optId}
                        id={optId}
                        role="option"
                        aria-selected={isActive}
                        onMouseDown={(e) => {
                          // Prevent input blur from firing before click.
                          e.preventDefault();
                          commit(entry);
                        }}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm ${
                          isActive ? 'bg-black/5 dark:bg-white/5' : ''
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{entry.displayName}</span>
                          {entry.kind === 'country' && entry.cityCount > 0 && (
                            <span className="ml-2 text-helper">
                              · {entry.cityCount}{' '}
                              {entry.cityCount === 1 ? 'city' : 'cities'}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wider text-helper">
                          {countLabel(entry.listingCount)}
                        </span>
                      </li>
                    );
                  })}
                </>
              )}
              {grouped.cities.length > 0 && (
                <>
                  <li
                    role="presentation"
                    className="px-4 pt-2 pb-1 font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper"
                  >
                    {citiesGroupLabel}
                  </li>
                  {grouped.cities.map(({ entry }, i) => {
                    const flatIdx = grouped.countries.length + i;
                    const e = entry as Extract<SearchIndexEntry, { kind: 'city' }>;
                    const optId = `${id}-opt-city-${e.countryCode}-${e.citySlug}`;
                    const isActive = activeIndex === flatIdx;
                    return (
                      <li
                        key={optId}
                        id={optId}
                        role="option"
                        aria-selected={isActive}
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          commit(entry);
                        }}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm ${
                          isActive ? 'bg-black/5 dark:bg-white/5' : ''
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{e.displayName}</span>
                        </span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wider text-helper">
                          {countLabel(entry.listingCount)}
                        </span>
                      </li>
                    );
                  })}
                </>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
