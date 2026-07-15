import { describe, it, expect } from 'vitest';
import type { ReviewOutcome } from '@devdigest/reviewer-core';
import { formatReviewForTerminal } from '../src/domain/format-review.js';

function outcome(overrides: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    review: {
      verdict: 'request_changes',
      summary: 'One risky change.',
      score: 62,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'bug',
          title: 'Null dereference',
          file: 'src/foo.ts',
          start_line: 10,
          end_line: 10,
          rationale: 'req.user may be undefined here.',
          suggestion: 'Add a guard clause.',
          confidence: 0.9,
        },
        {
          id: 'f2',
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Prefer const',
          file: 'src/foo.ts',
          start_line: 3,
          end_line: 5,
          rationale: 'This binding is never reassigned.',
          suggestion: null,
          confidence: 0.6,
        },
      ],
    },
    grounding: '2/2 passed',
    dropped: [],
    mode: 'single-pass',
    assembly: { system: 'sys', user: 'usr' },
    chunks: [],
    tokensIn: 1200,
    tokensOut: 340,
    costUsd: 0.0012,
    raw: '{}',
    ...overrides,
  };
}

describe('formatReviewForTerminal', () => {
  it('includes the agent, verdict, score, and summary', () => {
    const text = formatReviewForTerminal(outcome(), {
      agentName: 'General Reviewer',
      model: 'openrouter/deepseek-v4-flash',
      filesChanged: 1,
    });
    expect(text).toContain('Agent: General Reviewer (openrouter/deepseek-v4-flash)');
    expect(text).toContain('Verdict: REQUEST_CHANGES · Score: 62/100');
    expect(text).toContain('One risky change.');
  });

  it('lists findings CRITICAL-first with file:line and suggestion', () => {
    const text = formatReviewForTerminal(outcome(), {
      agentName: 'General Reviewer',
      model: 'm',
      filesChanged: 1,
    });
    const criticalIdx = text.indexOf('[CRITICAL] Null dereference');
    const suggestionIdx = text.indexOf('[SUGGESTION] Prefer const');
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(suggestionIdx).toBeGreaterThan(criticalIdx);
    expect(text).toContain('src/foo.ts:10');
    expect(text).toContain('Suggestion: Add a guard clause.');
  });

  it('prints "No findings." when the findings array is empty', () => {
    const text = formatReviewForTerminal(
      outcome({ review: { verdict: 'approve', summary: 'Looks fine.', score: 95, findings: [] } }),
      { agentName: 'General Reviewer', model: 'm', filesChanged: 1 },
    );
    expect(text).toContain('No findings.');
  });

  it('notes dropped findings from the citation-grounding gate', () => {
    const text = formatReviewForTerminal(
      outcome({
        dropped: [
          {
            finding: {
              id: 'f3',
              severity: 'WARNING',
              category: 'bug',
              title: 'X',
              file: 'src/bar.ts',
              start_line: 1,
              end_line: 1,
              rationale: 'r',
              suggestion: null,
              confidence: 0.5,
            },
            reason: 'no matching hunk',
          },
        ],
      }),
      { agentName: 'General Reviewer', model: 'm', filesChanged: 1 },
    );
    expect(text).toContain('1 finding(s) dropped by the citation-grounding gate');
  });

  it('omits the cost segment when costUsd is null', () => {
    const text = formatReviewForTerminal(outcome({ costUsd: null }), {
      agentName: 'General Reviewer',
      model: 'm',
      filesChanged: 1,
    });
    expect(text).not.toContain('$');
  });
});
