import { describe, it, expect } from 'vitest';
import {
  buildGroundingSet,
  groundBrief,
  selectContextDocs,
  buildDegradedSkeleton,
  type BriefContent,
} from '../src/modules/why-risk-brief/helpers.js';
import { buildBriefMessages, type BriefInputs } from '../src/modules/why-risk-brief/assemble.js';
import {
  INTENT_MAX_CHARS,
  BLAST_MAX_CHARS,
  SMART_DIFF_MAX_CHARS,
  LINKED_ISSUE_MAX_CHARS,
  CONTEXT_DOC_MAX_CHARS,
  CONTEXT_DOC_MAX_COUNT,
} from '../src/modules/why-risk-brief/constants.js';
import type {
  BlastRadius,
  DocumentInventoryItem,
  Intent,
  IssueMeta,
  Risk,
  ReviewFocusItem,
} from '@devdigest/shared';

function blastRadius(over: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: 'A summary of the blast radius.',
    degraded: false,
    degraded_reason: null,
    ...over,
  };
}

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'correctness',
    title: 'A risk',
    explanation: 'An explanation.',
    severity: 'medium',
    file_refs: [],
    ...over,
  };
}

function reviewFocusItem(over: Partial<ReviewFocusItem> = {}): ReviewFocusItem {
  return { file: 'src/a.ts', line: 1, reason: 'A reason.', ...over };
}

function inventoryDoc(over: Partial<DocumentInventoryItem> = {}): DocumentInventoryItem {
  return { path: 'docs/notes.md', root: 'docs', token_estimate: 100, ...over };
}

function intentFixture(over: Partial<Intent> = {}): Intent {
  return { intent: 'Adds a feature.', in_scope: [], out_of_scope: [], ...over };
}

function issueMetaFixture(over: Partial<IssueMeta> = {}): IssueMeta {
  return { number: 1, title: 'Issue title', body: 'Issue body.', state: 'open', ...over };
}

describe('buildGroundingSet', () => {
  it('returns the union of PR file paths and blast changed-symbol/caller files', () => {
    const files = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }];
    const blast = blastRadius({
      changed_symbols: [{ name: 'foo', file: 'src/lib/foo.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'foo',
          callers: [
            { name: 'handler', file: 'src/api/handler.ts', line: 10 },
            // Same file as another caller — proves the result is a Set (deduped).
            { name: 'other', file: 'src/api/handler.ts', line: 20 },
          ],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
    });

    const set = buildGroundingSet(files, blast);

    expect(set).toEqual(new Set(['src/a.ts', 'src/b.ts', 'src/lib/foo.ts', 'src/api/handler.ts']));
  });

  it('returns just the PR files when blast is undefined (AC-9)', () => {
    const files = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }];

    const set = buildGroundingSet(files, undefined);

    expect(set).toEqual(new Set(['src/a.ts', 'src/b.ts']));
  });
});

describe('groundBrief', () => {
  it(
    'drops a fabricated review_focus file entirely and keeps a risk with an empty ' +
      'file_refs array when its only ref is fabricated (AC-5)',
    () => {
      const groundingSet = new Set(['src/real.ts']);
      const raw: BriefContent = {
        what: 'What this PR does.',
        why: 'Why this PR exists.',
        risk_level: 'high',
        risks: [
          risk({ title: 'Mixed refs', file_refs: ['src/real.ts', 'src/fabricated.ts'] }),
          risk({ title: 'Only fabricated', severity: 'low', file_refs: ['src/fabricated.ts'] }),
        ],
        review_focus: [
          reviewFocusItem({ file: 'src/real.ts', reason: 'A real file worth reading.' }),
          reviewFocusItem({ file: 'src/fabricated.ts', reason: 'A model-invented path.' }),
        ],
      };

      const grounded = groundBrief(raw, groundingSet);

      // The fabricated ref is dropped from the mixed-refs risk, but the risk itself survives.
      // The risk whose ONLY ref was fabricated survives too, with an empty file_refs array.
      expect(grounded.risks).toEqual([
        risk({ title: 'Mixed refs', file_refs: ['src/real.ts'] }),
        risk({ title: 'Only fabricated', severity: 'low', file_refs: [] }),
      ]);
      // The review_focus item citing a fabricated path is dropped ENTIRELY (not kept with a
      // blanked-out file) — unlike a risk, a focus item with no valid file carries no signal.
      expect(grounded.review_focus).toEqual([
        reviewFocusItem({ file: 'src/real.ts', reason: 'A real file worth reading.' }),
      ]);
      // what/why/risk_level pass through untouched — grounding only ever filters file refs.
      expect(grounded.what).toBe('What this PR does.');
      expect(grounded.why).toBe('Why this PR exists.');
      expect(grounded.risk_level).toBe('high');
    },
  );
});

describe('selectContextDocs', () => {
  it('prefers an architecture/invariant/convention-named doc over a same-size non-matching doc (AC-12)', () => {
    const nonMatching = inventoryDoc({ path: 'docs/random.md', token_estimate: 100 });
    const architectureDoc = inventoryDoc({ path: 'docs/architecture.md', token_estimate: 100 });

    // Non-matching doc listed FIRST, to prove name-preference wins over input order too.
    const selected = selectContextDocs([nonMatching, architectureDoc], 1);

    expect(selected).toEqual([architectureDoc]);
  });

  it('returns at most maxDocs items (preferred group first, then ascending size within each group)', () => {
    const items = [
      inventoryDoc({ path: 'docs/a.md', token_estimate: 10 }),
      inventoryDoc({ path: 'docs/b.md', token_estimate: 20 }),
      inventoryDoc({ path: 'docs/invariants.md', token_estimate: 40 }),
      inventoryDoc({ path: 'docs/c.md', token_estimate: 30 }),
    ];

    const selected = selectContextDocs(items, 2);

    expect(selected).toHaveLength(2);
    // The larger preferred doc still wins the first slot over smaller non-matching docs;
    // the second slot goes to the smallest of the rest.
    expect(selected.map((d) => d.path)).toEqual(['docs/invariants.md', 'docs/a.md']);
  });

  it('is stable (deterministic, non-mutating) across a repeated call with the same input', () => {
    const items = [
      inventoryDoc({ path: 'docs/a.md', token_estimate: 10 }),
      inventoryDoc({ path: 'docs/convention-guide.md', token_estimate: 10 }),
      inventoryDoc({ path: 'docs/b.md', token_estimate: 5 }),
    ];
    const itemsSnapshot = [...items];

    const first = selectContextDocs(items, 3);
    const second = selectContextDocs(items, 3);

    expect(second).toEqual(first);
    // The input array itself is untouched (order/contents), not sorted in place.
    expect(items).toEqual(itemsSnapshot);
  });
});

describe('buildDegradedSkeleton', () => {
  it('never returns a risk_level other than "medium", regardless of intent presence (AC-11)', () => {
    const withIntent = buildDegradedSkeleton('Add rate limiting', intentFixture(), 'reason A');
    const withoutIntent = buildDegradedSkeleton('Add rate limiting', undefined, 'reason B');

    for (const skeleton of [withIntent, withoutIntent]) {
      expect(skeleton.risk_level).toBe('medium');
      expect(skeleton.risks).toEqual([]);
      expect(skeleton.review_focus).toEqual([]);
      expect(skeleton.degraded).toBe(true);
      // AD-4: no successful synthesis call was made, so no cost/tokens to report.
      expect(skeleton.tokens_in).toBeNull();
      expect(skeleton.tokens_out).toBeNull();
      expect(skeleton.cost_usd).toBeNull();
    }
    expect(withIntent.degraded_reason).toBe('reason A');
    expect(withoutIntent.degraded_reason).toBe('reason B');
  });

  it('derives what/why verbatim from intent.intent when present, never adding beyond it', () => {
    const intent = intentFixture({ intent: 'Adds a rate limiter to the public API.' });

    const skeleton = buildDegradedSkeleton('Add rate limiting', intent, 'reason');

    expect(skeleton.what).toBe(intent.intent);
    expect(skeleton.why).toBe(intent.intent);
  });

  it('falls back to a static sentence naming only prTitle when intent is absent, never inventing a claim', () => {
    const prTitle = 'Add rate limiting';
    const expectedFallback =
      `No summary is available yet for "${prTitle}" — the risk brief could not be generated ` +
      'and no persisted intent was found to fall back on.';

    const skeleton = buildDegradedSkeleton(prTitle, undefined, 'reason');

    expect(skeleton.what).toBe(expectedFallback);
    expect(skeleton.why).toBe(expectedFallback);
  });
});

describe('buildBriefMessages — AC-6 (no diff-body input)', () => {
  it('never contains a substring from a fixture PrFile.patch-shaped diff body anywhere in its output', () => {
    // Shape of a real PrFile.patch — content BriefInputs has NO field to carry at all (no
    // `prFiles`, no `patch`, no `diff` key — see assemble.ts's own doc comment). TypeScript's
    // excess-property check would refuse this object literal for a BriefInputs-typed parameter,
    // so the only way a real caller could route it through is by mistake, via an `as` cast that
    // bolts it onto the plain JS object as an extra key the type system never sanctioned.
    // Simulate exactly that, to prove buildBriefMessages reads only its declared named fields
    // and never a generic dump of the whole input object.
    const PATCH_MARKER = 'PATCH_ONLY_MARKER_9f3c1a';
    const patchBody =
      '@@ -12,7 +12,7 @@ export function rateLimit(req: Request) {\n' +
      '-  const limit = 100;\n' +
      `+  const limit = ${PATCH_MARKER};\n` +
      '   return limit;\n' +
      ' }';

    const mistakenInputs = {
      prTitle: 'Add rate limiting',
      intent: intentFixture({ intent: 'Adds a rate limiter to the public API.' }),
      blast: blastRadius({ summary: 'Touches the public rate-limit path.' }),
      smartDiffCounts: [{ role: 'core' as const, count: 2 }],
      linkedIssue: issueMetaFixture({ title: 'Add rate limiting', body: 'Please add a limiter.' }),
      contextDocs: [{ path: 'docs/architecture.md', content: 'Architecture notes.' }],
      findingsSummary: { critical: 1, warning: 2, suggestion: 0 },
      // Illegitimate: not part of BriefInputs; simulates a caller mistake.
      prFiles: [{ path: 'src/rate-limit.ts', additions: 1, deletions: 1, patch: patchBody }],
    } as unknown as BriefInputs;

    const messages = buildBriefMessages(mistakenInputs);
    const combined = messages.map((m) => m.content).join('\n');

    expect(combined).not.toContain(PATCH_MARKER);
    expect(combined).not.toContain(patchBody);
    expect(combined).not.toContain('@@ -12,7 +12,7 @@');
  });
});

describe('buildBriefMessages — AC-7 (8,000-token budget, by construction)', () => {
  it('stays at or under 8,000 tokens (~4 chars/token) even when every capped input is maximally oversized', () => {
    const oversizedIntent = intentFixture({ intent: 'A'.repeat(INTENT_MAX_CHARS * 3) });
    const oversizedBlast = blastRadius({ summary: 'B'.repeat(BLAST_MAX_CHARS * 3) });
    // Enough entries that the joined "N role" line comfortably exceeds SMART_DIFF_MAX_CHARS,
    // exercising buildBriefMessages's own truncateToBytes call for this section.
    const oversizedSmartDiffCounts = Array.from({ length: 300 }, (_, i) => ({
      role: (['core', 'wiring', 'boilerplate'] as const)[i % 3]!,
      count: i,
    }));
    const oversizedLinkedIssue = issueMetaFixture({
      title: 'A linked issue with a very long body',
      body: 'C'.repeat(LINKED_ISSUE_MAX_CHARS * 3),
    });
    // Context docs are NOT re-truncated by buildBriefMessages — assemble.ts's own doc comment
    // says the caller (service.ts, a later task) is responsible for pre-capping each doc's
    // content at CONTEXT_DOC_MAX_CHARS before it ever reaches this function. The "maximally
    // oversized" input WITHIN this function's actual contract is therefore CONTEXT_DOC_MAX_COUNT
    // docs each exactly at CONTEXT_DOC_MAX_CHARS — the worst case constants.ts's own header
    // comment budgets for.
    const oversizedContextDocs = Array.from({ length: CONTEXT_DOC_MAX_COUNT }, (_, i) => ({
      path: `docs/context-doc-${i}.md`,
      content: 'D'.repeat(CONTEXT_DOC_MAX_CHARS),
    }));

    const inputs: BriefInputs = {
      prTitle: 'Add rate limiting to the public API',
      intent: oversizedIntent,
      blast: oversizedBlast,
      smartDiffCounts: oversizedSmartDiffCounts,
      linkedIssue: oversizedLinkedIssue,
      contextDocs: oversizedContextDocs,
      // Not part of the capped inputs (AD-5's own section is small/fixed-format,
      // no MAX_CHARS constant) — a realistic value is enough here.
      findingsSummary: { critical: 3, warning: 5, suggestion: 2 },
    };

    const messages = buildBriefMessages(inputs);
    const combinedChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = combinedChars / 4;

    expect(estimatedTokens).toBeLessThanOrEqual(8000);
  });
});
