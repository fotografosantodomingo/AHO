#!/usr/bin/env tsx
/**
 * lint-write-safety — guards two antipatterns documented in CLAUDE.md
 * that have produced real prod incidents:
 *
 *   1. "supabase-js does NOT throw on row-level errors." Writes
 *      (.insert / .update / .upsert / .delete) MUST destructure
 *      { error } and check it. Without that, RLS / CHECK / FK
 *      rejections silently produce 0 rows in prod with zero logs.
 *      → bug class fixed in 2026-05-24 audit (13 sites).
 *
 *   2. "Edge runtime cancels unawaited promises." Server-side writes
 *      that should happen inside the request lifecycle must be
 *      `await`ed, not `void`. → bug class fixed in 2026-05-24 audit
 *      (pingIndexNow site) + the earlier 2026-05-17 logAiCall fix.
 *
 *   3. Bonus — response bodies returning raw `*.message` from any
 *      Supabase / upstream API error. Leaks SQL fragments, table
 *      names, RLS hints, OAuth provider error text to anon callers.
 *      → bug class fixed in 2026-05-24 audit (27 sites).
 *
 * This script is intentionally LINE-REGEX based (not AST). Trade-offs:
 *   ✓ Zero deps, runs in ~200ms across the whole `src/` tree.
 *   ✓ Easy to read + extend.
 *   ✗ Multi-line statements that span past 1-2 lines past the await
 *     can produce false positives. The known-safe sites are listed
 *     in ALLOWLIST below — add to it (with a justifying comment) if
 *     the scanner flags a real false positive.
 *
 * Exits 0 if clean, 1 if any violations remain. Wire into
 * `.githooks/pre-push` as Gate 4 so a new regression can't reach
 * main without explicit allowlist sign-off.
 *
 * To run manually: `pnpm lint:write-safety` (alias) OR
 * `pnpm tsx scripts/lint-write-safety.ts`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Files where a flagged pattern is intentional / known-safe.
// Add new entries with a justifying comment so future contributors
// can decide whether to keep or refactor.
const ALLOWLIST: Array<{ path: string; reason: string }> = [
  { path: 'tests/', reason: 'test fixtures use shorthand for speed' },
];

// Category-3 (error-leak) is scoped to API routes, but cron routes
// have a trusted-only consumer: their callers are standalone Workers
// authenticated by CRON_SECRET. Worker `console.error` ops logs do
// rely on the cause line to debug failures, so opaque-code-only
// returns would degrade ops debuggability without any anon-facing
// security benefit.
const ERROR_LEAK_PATH_SKIP = [/\/src\/app\/api\/cron\//];

const ROOT = join(__dirname, '..');
const SRC_ROOTS = [
  join(ROOT, 'src/app/api'),
  join(ROOT, 'src/lib'),
  join(ROOT, 'workers'),
];

interface Violation {
  category: 'unawaited-write' | 'missing-destructure' | 'error-leak';
  file: string;
  line: number;
  snippet: string;
  rationale: string;
}

const violations: Violation[] = [];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.next' || name === '.vercel' || name === 'dist') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function isAllowed(file: string): boolean {
  const rel = relative(ROOT, file);
  return ALLOWLIST.some((e) => rel.includes(e.path));
}

// Category 1 — unawaited supabase / fetch writes
// Pattern: `void <ident>.from(...)` or `void <ident>.rpc(...)`
function scanCategory1(file: string, lines: string[]): void {
  if (isAllowed(file)) return;
  lines.forEach((line, idx) => {
    if (/\bvoid\s+\w+(\s*\??\.\s*\w+)*\.(from|rpc)\(/.test(line)) {
      violations.push({
        category: 'unawaited-write',
        file,
        line: idx + 1,
        snippet: line.trim(),
        rationale: 'Edge runtime cancels unawaited promises — use await instead of void',
      });
    }
  });
}

// Category 2 — supabase write without `{ error }` destructure
// Looks at the previous up-to-3 lines for `const { error` or `const {`
// destructure binding. Calls like
//   `await sb.from('x').insert(y)` directly on a line that ISN'T
// captured into a const/let → flagged.
function scanCategory2(file: string, lines: string[]): void {
  if (isAllowed(file)) return;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match the chained call. We accept .insert/.update/.upsert/.delete.
    // The capture group has no specific shape but must be preceded by
    // `await` on the same line OR a recent line that begins the await
    // chain. We keep the rule strict: the LINE must start (after
    // whitespace) with `await ` AND not have a `const ... =` capture
    // earlier on the SAME line.
    if (!/^\s*await\s/.test(line)) continue;
    if (!/\.(insert|update|upsert|delete)\s*\(/.test(line)) continue;
    // Direct-on-the-line capture? e.g. `const { error } = await ...` or
    // `const r = await ...`.
    if (/^\s*(const|let|var)\s/.test(line)) continue;
    // Look back up to 3 lines for a multi-line chain start with a
    // capture. e.g.
    //   const { error } = await sb
    //     .from('x')
    //     .insert(y);
    let captured = false;
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const prev = lines[j]!;
      if (/^\s*(const|let|var)\s.*=\s*await\s/.test(prev)) {
        captured = true;
        break;
      }
      // If the previous line is blank or a statement terminator, stop
      // looking (the chain we're inspecting starts on a fresh line).
      if (/^\s*$/.test(prev) || /;\s*(\/\/.*)?$/.test(prev)) break;
    }
    if (captured) continue;
    // Some `await` lines just await a Promise.all([...]) or a function
    // call that internally handles errors. We narrow to: the LINE must
    // have a `.from(` OR `.rpc(` somewhere in the chain. Without that
    // we skip — Promise.all and helper calls are out of scope.
    if (!/\.(from|rpc)\s*\(/.test(line) && !/\bsupabase\b|\badmin\b|\bsb\b/.test(line)) {
      // Last-chance check: the previous 3 lines.
      let chainHasFromOrRpc = false;
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (/\.(from|rpc)\s*\(/.test(lines[j]!)) {
          chainHasFromOrRpc = true;
          break;
        }
      }
      if (!chainHasFromOrRpc) continue;
    }
    violations.push({
      category: 'missing-destructure',
      file,
      line: i + 1,
      snippet: line.trim(),
      rationale: 'supabase-js writes do not throw on row-level errors — destructure { error } and check it',
    });
  }
}

// Category 3 — API route response bodies returning raw `*.message`
// from a Supabase / upstream error.
// SCOPED to `src/app/api/**` ONLY because that's the security
// boundary (response goes to anon callers). Internal helpers in
// `src/lib/**` legitimately propagate error context UPWARD through
// return values so the API route can decide how to wrap it.
function scanCategory3(file: string, lines: string[]): void {
  if (isAllowed(file)) return;
  if (!file.includes('/src/app/api/')) return;
  if (ERROR_LEAK_PATH_SKIP.some((re) => re.test(file))) return;
  // Track whether the current line is inside a multi-line console.*
  // call. We approximate by scanning the previous up-to-6 lines for
  // an unclosed `console.X(` opener.
  function inConsoleCall(idx: number): boolean {
    for (let j = idx; j >= Math.max(0, idx - 6); j--) {
      const prev = lines[j]!;
      if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(prev)) {
        // Found an opener. Check if it has closed before our line.
        let depth = 0;
        for (let k = j; k <= idx; k++) {
          for (const ch of lines[k]!) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
          }
        }
        return depth > 0;
      }
      // Lines that clearly start a new statement break the search
      if (/^\s*(const|let|var|if|for|while|return|throw)\s/.test(prev)) break;
    }
    return false;
  }

  lines.forEach((line, idx) => {
    if (/\bconsole\.(log|warn|error|info|debug)\(/.test(line)) return;
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
    // The right-side identifier chain must LOOK like an error: contain
    // /err/i somewhere in the chain. That rules out legitimate `.message`
    // FIELDS on data rows (lead.message, applicant message text, etc.).
    const match = line.match(
      /\b(error|errorCode|errorMessage|message)\s*:\s*(\w+(?:\s*\??\.\s*\w+)*)\.message\b/,
    );
    if (!match) return;
    const rhs = match[2] ?? '';
    if (!/err|Err|error|Error/.test(rhs)) return;
    // Allow Zod parse errors — bounded user-input feedback.
    if (/parsed\.error\.|\.flatten\(\)|zodErr\.|ZodError|fromZodError/.test(line)) return;
    if (inConsoleCall(idx)) return;
    violations.push({
      category: 'error-leak',
      file,
      line: idx + 1,
      snippet: line.trim(),
      rationale: 'raw error.message in route response body leaks SQL / RLS / API internals — use an opaque code and log details to console.error instead',
    });
  });
}

function scanFile(file: string): void {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  scanCategory1(file, lines);
  scanCategory2(file, lines);
  scanCategory3(file, lines);
}

function main(): void {
  const files = SRC_ROOTS.flatMap((r) => walk(r));
  for (const f of files) scanFile(f);

  if (violations.length === 0) {
    console.log(`[lint-write-safety] ✓ ${files.length} files scanned — clean.`);
    process.exit(0);
  }

  // Group by category for readable output
  const byCat: Record<string, Violation[]> = {};
  for (const v of violations) (byCat[v.category] ??= []).push(v);

  console.error(`[lint-write-safety] ✗ ${violations.length} violation(s) across ${files.length} files:\n`);
  for (const cat of Object.keys(byCat)) {
    const list = byCat[cat]!;
    console.error(`  ${cat} (${list.length}):`);
    for (const v of list) {
      const rel = relative(ROOT, v.file);
      console.error(`    ${rel}:${v.line}  ${v.snippet}`);
      console.error(`      ↳ ${v.rationale}`);
    }
    console.error('');
  }
  console.error(
    '[lint-write-safety] Fix the violations above OR add a justifying entry to ALLOWLIST in scripts/lint-write-safety.ts.',
  );
  process.exit(1);
}

main();
