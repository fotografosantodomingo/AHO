'use client';

/**
 * Renders a chat message body with light markdown support:
 *   - `[label](url)`     → <a href="url">label</a>
 *   - bare `https://...` → <a href="...">...</a>
 *   - bare `/path/...`   → <a href="/path/...">/path/...</a>
 *   - double-asterisk    → <strong>text</strong>
 *   - newlines preserved (whitespace-pre-line)
 *
 * Safety: only allows href values that start with `http://`, `https://`,
 * or `/` (relative AHO path). Anything else (e.g. `javascript:`) falls
 * back to plain text so a model-emitted scheme can never become an
 * executable link. Children of the link are escaped by React JSX, so
 * label content is XSS-safe.
 *
 * External vs. internal: same-origin links (`/foo`) open in the same
 * tab; off-origin (`https://...`) open in a new tab with rel="noopener".
 *
 * Split into a pure `parseMessage()` (testable without JSX transform)
 * and the React component that maps tokens to nodes.
 */

import { Fragment, type ReactNode } from 'react';

export type MessageToken =
  | { kind: 'text'; value: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'bold'; value: string };

// Patterns recognized in priority order:
//   1. Markdown link `[label](url)`
//   2. Bold span (double asterisk)
//   3. Bare absolute URL `https://…`
//   4. Bare relative path `/path/…` (with optional hash/query)
const TOKEN_RE =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>"')\]]+)|(\/[a-zA-Z0-9][a-zA-Z0-9_\-/]*(?:#[a-zA-Z0-9_\-]+)?(?:\?[a-zA-Z0-9_\-=&%]+)?)/g;

function isSafeHref(raw: string): boolean {
  if (raw.startsWith('/')) return !raw.startsWith('//');
  if (raw.startsWith('http://') || raw.startsWith('https://')) return true;
  return false;
}

function isExternal(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

/**
 * Pure tokenizer — returns a flat array of typed segments. Unsafe
 * link schemes fall back to a text token containing the original
 * label so the link doesn't appear clickable.
 */
export function parseMessage(body: string): MessageToken[] {
  const out: MessageToken[] = [];
  let cursor = 0;
  // Reset the module-level regex's lastIndex on each call. Without
  // this, a second parseMessage() call would skip matches because
  // /g regexes carry state across .exec() invocations.
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    if (m.index > cursor) {
      out.push({ kind: 'text', value: body.slice(cursor, m.index) });
    }
    const [, mdLabel, mdHref, boldText, bareUrl, barePath] = m;
    if (mdLabel != null && mdHref != null) {
      if (isSafeHref(mdHref)) {
        out.push({ kind: 'link', href: mdHref, label: mdLabel });
      } else {
        // Unsafe scheme — render the bracketed label as plain text,
        // dropping the link entirely so it never appears clickable.
        out.push({ kind: 'text', value: mdLabel });
      }
    } else if (boldText != null) {
      out.push({ kind: 'bold', value: boldText });
    } else if (bareUrl != null) {
      out.push({ kind: 'link', href: bareUrl, label: bareUrl });
    } else if (barePath != null) {
      out.push({ kind: 'link', href: barePath, label: barePath });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < body.length) {
    out.push({ kind: 'text', value: body.slice(cursor) });
  }
  return out;
}

export function ChatMessageBody({
  body,
  streaming,
}: {
  body: string;
  streaming?: boolean;
}) {
  const tokens = parseMessage(body);
  return (
    <p className="whitespace-pre-line leading-relaxed">
      {tokens.map((tok, i) => {
        if (tok.kind === 'text') {
          return <Fragment key={`t-${i}`}>{tok.value}</Fragment>;
        }
        if (tok.kind === 'bold') {
          return <strong key={`b-${i}`}>{tok.value}</strong>;
        }
        // tok.kind === 'link'
        const external = isExternal(tok.href);
        return (
          <a
            key={`a-${i}`}
            href={tok.href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="text-action underline underline-offset-2 hover:opacity-80 dark:text-action-dark"
          >
            {tok.label}
          </a>
        );
      })}
      {streaming && (
        <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-current align-middle" />
      )}
    </p>
  );
}

// Re-export internal helpers for tests that want to mirror what the
// component does (e.g. external-vs-internal classification).
export const __test__ = { isSafeHref, isExternal };
