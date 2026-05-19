// Unit tests for src/components/chat/render-message.tsx — pure
// tokenizer (parseMessage). Catches the regression we just fixed
// where both chat widgets rendered `m.body` as plain text and the
// AI's double-asterisk-wrapped paths came through as literal
// characters instead of clickable links.

import { describe, expect, it } from 'vitest';
import {
  parseMessage,
  type MessageToken,
} from '@/components/chat/render-message';

function links(tokens: MessageToken[]) {
  return tokens.filter(
    (t): t is Extract<MessageToken, { kind: 'link' }> => t.kind === 'link',
  );
}

function bolds(tokens: MessageToken[]) {
  return tokens.filter(
    (t): t is Extract<MessageToken, { kind: 'bold' }> => t.kind === 'bold',
  );
}

describe('parseMessage() — markdown link parsing', () => {
  it('renders [label](/relative) as a link token with the label preserved', () => {
    const t = links(parseMessage('See [Pricing](/pricing) for tier details.'))[0];
    expect(t?.href).toBe('/pricing');
    expect(t?.label).toBe('Pricing');
  });

  it('renders [label](https://...) as a link with the absolute URL', () => {
    const t = links(parseMessage('Check [our blog](https://blog.example.com/post).'))[0];
    expect(t?.href).toBe('https://blog.example.com/post');
    expect(t?.label).toBe('our blog');
  });

  it('strips unsafe href schemes (javascript:) to text', () => {
    const tokens = parseMessage('Click [here](javascript:alert(1))');
    expect(links(tokens)).toHaveLength(0);
    // The bracketed label survives as text — the link is dropped.
    expect(tokens.some((t) => t.kind === 'text' && t.value.includes('here'))).toBe(true);
  });

  it('strips protocol-relative URLs (//evil) to text', () => {
    const tokens = parseMessage('Visit [click](//evil.example.com)');
    expect(links(tokens)).toHaveLength(0);
  });
});

describe('parseMessage() — bare URL autolink', () => {
  it('autolinks bare https://...', () => {
    const t = links(parseMessage('Visit https://advertisehomes.online for details.'))[0];
    expect(t?.href).toBe('https://advertisehomes.online');
  });

  it('autolinks bare /relative/path', () => {
    const t = links(parseMessage('Try /sell/private to start.'))[0];
    expect(t?.href).toBe('/sell/private');
  });

  it('autolinks /docs without trailing punctuation', () => {
    const t = links(parseMessage('See /docs for guides.'))[0];
    expect(t?.href).toBe('/docs');
  });
});

describe('parseMessage() — bold parsing', () => {
  it('renders double-asterisk text as a bold token', () => {
    const b = bolds(parseMessage('Plans **start at $29/mo** for agents.'));
    expect(b.map((t) => t.value)).toEqual(['start at $29/mo']);
  });
});

describe('parseMessage() — mixed', () => {
  it('passes plain text through verbatim', () => {
    expect(parseMessage('Hello world.')).toEqual([
      { kind: 'text', value: 'Hello world.' },
    ]);
  });

  it('handles multiple markdown links in one body', () => {
    const ls = links(parseMessage('Visit [Pricing](/pricing) or [Docs](/docs).'));
    expect(ls).toHaveLength(2);
    expect(ls[0]?.href).toBe('/pricing');
    expect(ls[1]?.href).toBe('/docs');
  });

  it('mixes bare URL + markdown link + bold in one body', () => {
    const tokens = parseMessage(
      '**Pro Automation** at https://advertisehomes.online/pricing — [start free](/sell).',
    );
    expect(bolds(tokens)).toHaveLength(1);
    expect(links(tokens)).toHaveLength(2);
  });
});

describe('parseMessage() — stateful regex regression guard', () => {
  it('returns identical tokens on repeat calls (lastIndex reset)', () => {
    const body = 'See [Pricing](/pricing) for tiers.';
    const first = links(parseMessage(body));
    const second = links(parseMessage(body));
    expect(second.map((t) => t.href)).toEqual(first.map((t) => t.href));
  });
});
