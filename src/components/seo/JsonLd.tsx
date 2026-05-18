import { serializeJsonLd, type JsonLdNode } from '@/lib/seo/jsonld';

/**
 * Server component that emits one `<script type="application/ld+json">`
 * tag containing the serialized JSON-LD node (or array of nodes).
 *
 * Prefer passing a single `@graph` document (see `buildGraph`) over an
 * array — Google's docs recommend one parse pass per page, and the
 * `@graph` form lets nodes cross-reference each other via `@id`.
 *
 * Placement: render in the page body, not `<head>`. Next.js App Router
 * doesn't reliably dedup `<script>` injected into `<head>` from RSCs,
 * and Google's crawler reads JSON-LD from anywhere in the document.
 */
export function JsonLd({ node }: { node: JsonLdNode | JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      // serializeJsonLd escapes `<` → < so an attacker-controlled
      // string field can't break out of the host <script> element.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}
    />
  );
}
