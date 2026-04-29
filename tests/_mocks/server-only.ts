// Vitest alias for `server-only`. The real package throws on import to
// prevent leaking server modules into client bundles. In tests we run
// modules directly in Node — no client/server distinction — so we replace
// the throw with a no-op.

export {};
