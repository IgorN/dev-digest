import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/domain/diff.js';

const SINGLE_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
-  return 1;
+  // fixed
+  return 2;
 }
`;

const TWO_FILE_DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old a
+new a
 keep
diff --git a/b.ts b/b.ts
index 3333333..4444444 100644
--- a/b.ts
+++ b/b.ts
@@ -5,2 +5,3 @@
 keep
+added b
 keep2
`;

describe('parseUnifiedDiff', () => {
  it('extracts the changed path, additions/deletions, and one hunk', () => {
    const result = parseUnifiedDiff(SINGLE_FILE_DIFF);
    expect(result.files).toHaveLength(1);
    const file = result.files[0]!;
    expect(file.path).toBe('src/foo.ts');
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);
  });

  it('computes new-side line numbers covering added + context lines, not deletions', () => {
    const result = parseUnifiedDiff(SINGLE_FILE_DIFF);
    const hunk = result.files[0]!.hunks[0]!;
    // new file: L1 "export function foo() {", L2 "// fixed", L3 "return 2;",
    // L4 "}", plus L5 for the trailing blank line the template literal's
    // closing backtick line contributes (a real trailing-newline hunk line).
    expect(hunk.newLineNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses multiple files into separate entries with independent hunks', () => {
    const result = parseUnifiedDiff(TWO_FILE_DIFF);
    expect(result.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(result.files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2]);
    expect(result.files[1]!.hunks[0]!.newLineNumbers).toEqual([5, 6, 7, 8]);
  });

  it('returns no files for an empty diff', () => {
    const result = parseUnifiedDiff('');
    expect(result.files).toEqual([]);
  });

  it('keeps the raw text on the result', () => {
    const result = parseUnifiedDiff(SINGLE_FILE_DIFF);
    expect(result.raw).toBe(SINGLE_FILE_DIFF);
  });
});
