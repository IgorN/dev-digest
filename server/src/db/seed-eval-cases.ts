/**
 * Seeded eval cases (L06) for the built-in "API Contract Reviewer" agent.
 *
 * An eval case is a frozen regression fixture: a stored unified-diff fragment
 * (`input_diff`, parsed the same way `diff-loader.ts` reconstructs a diff from
 * `pr_files` patches — `diff --git a/<path> b/<path>` + `--- a/<path>` +
 * `+++ b/<path>` + `@@ ... @@` hunks, so it round-trips through
 * `parseUnifiedDiff` unchanged) plus an `expected_output` array of expectation
 * items scored against a real run of the owning agent.
 *
 * `API Contract Reviewer` is the richest-configured seeded agent (5 linked
 * skills — `breaking-change`, `response-schema`, `semver-discipline`,
 * `deprecation-policy`, `api-contract-gate` — see `SKILL_LINKS` in
 * `seed-skills.ts`) and the seed already ships a purpose-built fixture PR
 * (#517, `acme/payments-api`) demonstrating exactly the failure mode this
 * agent exists to catch, so it doubles as the natural home for eval cases.
 *
 * Expectation item shape (informal, `expected_output: jsonb` — mirrors
 * `server/src/modules/eval/types.ts`'s `ExpectationItem`, not itself imported
 * here to avoid a cross-task dependency during parallel development):
 *   { type: 'must_find' | 'must_not_flag', file, start_line, end_line?,
 *     severity?, category?, title? }
 *
 * `must_find` — a real breaking-change the agent should re-find on every run.
 * `must_not_flag` — a confirmed false positive: a safe/additive change the
 * agent must NOT raise a finding against.
 */

export interface SeedEvalExpectationItem {
  type: 'must_find' | 'must_not_flag';
  file: string;
  start_line: number;
  end_line?: number;
  severity?: string;
  category?: string;
  title?: string;
}

export interface SeedEvalCase {
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: Record<string, unknown>;
  expectedOutput: SeedEvalExpectationItem[];
  notes?: string;
}

/** Name of the seeded agent these eval cases are attached to (`owner_kind: 'agent'`). */
export const EVAL_CASE_AGENT_NAME = 'API Contract Reviewer';

const REPO_FULL_NAME = 'acme/payments-api';

export const SEED_EVAL_CASES: SeedEvalCase[] = [
  // ---------------------------------------------------------------- must_find (5)
  {
    name: 'breaking-rename-response-field',
    inputDiff: `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -10,8 +10,8 @@ export async function getUser(id: string): Promise<Result<User, ApiError>> {
   const user = await db.users.find(id);
   if (!user) {
     return err({ code: "not_found", message: "User not found" });
   }
-  // Public response — clients read \`name\`.
-  return ok({ id: user.id, name: user.name, email: user.email });
+  // Public response — clients read \`fullName\`.
+  return ok({ id: user.id, fullName: user.name, email: user.email });
 }`,
    inputFiles: ['src/api/users.ts'],
    inputMeta: {
      pr_title: 'Rename user response field name → fullName',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0001renamefullname',
    },
    expectedOutput: [
      {
        type: 'must_find',
        file: 'src/api/users.ts',
        start_line: 14,
        end_line: 15,
        severity: 'CRITICAL',
        category: 'contract',
        title: 'Breaking rename of response field `name` → `fullName`',
      },
    ],
    notes:
      'Mirrors the seeded PR #517 fixture (acme/payments-api) — a generic reviewer waves this through, API Contract Reviewer + its skills catch it.',
  },
  {
    name: 'route-removed-without-deprecation',
    inputDiff: `diff --git a/src/api/routes/payments.ts b/src/api/routes/payments.ts
--- a/src/api/routes/payments.ts
+++ b/src/api/routes/payments.ts
@@ -17,4 +17,3 @@ export function registerPaymentRoutes(app: FastifyInstance) {
 app.get('/v1/payments/:id', getPayment);
-app.post('/v1/charge', legacyCharge);
 app.post('/v1/refunds', createRefund);
 app.get('/v1/payments', listPayments);`,
    inputFiles: ['src/api/routes/payments.ts'],
    inputMeta: {
      pr_title: 'Remove legacy /v1/charge route',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0002routeremoved',
    },
    expectedOutput: [
      {
        type: 'must_find',
        file: 'src/api/routes/payments.ts',
        start_line: 17,
        end_line: 18,
        severity: 'CRITICAL',
        category: 'contract',
        title: 'Route /v1/charge removed with no deprecation alias or version gate',
      },
    ],
  },
  {
    name: 'new-required-field-breaks-callers',
    inputDiff: `diff --git a/src/api/schemas/order.ts b/src/api/schemas/order.ts
--- a/src/api/schemas/order.ts
+++ b/src/api/schemas/order.ts
@@ -4,6 +4,7 @@ import { z } from 'zod';
 export const CreateOrderInput = z.object({
   userId: z.string(),
   amount: z.number().positive(),
+  shippingRegion: z.string(),
   currency: z.string().default('USD'),
 });`,
    inputFiles: ['src/api/schemas/order.ts'],
    inputMeta: {
      pr_title: 'Add shippingRegion to CreateOrderInput',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0003requiredfield',
    },
    expectedOutput: [
      {
        type: 'must_find',
        file: 'src/api/schemas/order.ts',
        start_line: 7,
        end_line: 7,
        severity: 'CRITICAL',
        category: 'contract',
        title: 'New required request field `shippingRegion` breaks existing callers',
      },
    ],
  },
  {
    name: 'success-status-code-changed',
    inputDiff: `diff --git a/src/api/routes/orders.ts b/src/api/routes/orders.ts
--- a/src/api/routes/orders.ts
+++ b/src/api/routes/orders.ts
@@ -29,7 +29,7 @@ export async function createOrderHandler(req: FastifyRequest, reply: FastifyReply) {
   const result = await createOrder(req.body);
   if (!result.ok) {
     return reply.code(400).send(result.error);
   }
-  return reply.code(200).send(result.value);
+  return reply.code(201).send(result.value);
 }`,
    inputFiles: ['src/api/routes/orders.ts'],
    inputMeta: {
      pr_title: 'Return 201 from order creation',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0004statuscode',
    },
    expectedOutput: [
      {
        type: 'must_find',
        file: 'src/api/routes/orders.ts',
        start_line: 33,
        end_line: 33,
        severity: 'CRITICAL',
        category: 'contract',
        title: 'Success status code changed 200 → 201 without a version gate',
      },
    ],
  },
  {
    name: 'removed-field-shipped-as-patch-bump',
    inputDiff: `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -39,6 +39,5 @@ export async function getUserProfile(id: string): Promise<Result<UserProfile, ApiError>> {
   const user = await db.users.find(id);
   if (!user) {
     return err({ code: "not_found", message: "User not found" });
   }
-  return ok({ id: user.id, name: user.name, email: user.email, legacyId: user.id });
+  return ok({ id: user.id, name: user.name, email: user.email });
 }
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2,4 +2,4 @@
 {
   "name": "acme-payments-api",
-  "version": "1.4.2",
+  "version": "1.4.3",
   "description": "Payments API",`,
    inputFiles: ['src/api/users.ts', 'package.json'],
    inputMeta: {
      pr_title: 'Drop unused legacyId from user profile response',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0005patchbump',
    },
    expectedOutput: [
      {
        type: 'must_find',
        file: 'src/api/users.ts',
        start_line: 43,
        end_line: 43,
        severity: 'CRITICAL',
        category: 'contract',
        title: 'Removed response field `legacyId` shipped as a patch bump (1.4.2 → 1.4.3), not major',
      },
    ],
  },
  // ---------------------------------------------------------- must_not_flag (3)
  {
    name: 'additive-optional-response-field',
    inputDiff: `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -59,7 +59,8 @@ export async function getUserSettings(id: string): Promise<Result<UserSettings, ApiError>> {
   const user = await db.users.find(id);
   if (!user) {
     return err({ code: "not_found", message: "User not found" });
   }
-  return ok({ id: user.id, name: user.name, email: user.email });
+  const avatarUrl = user.avatarUrl ?? null;
+  return ok({ id: user.id, name: user.name, email: user.email, avatarUrl });
 }`,
    inputFiles: ['src/api/users.ts'],
    inputMeta: {
      pr_title: 'Add optional avatarUrl to user settings response',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0006additivefield',
    },
    expectedOutput: [
      {
        type: 'must_not_flag',
        file: 'src/api/users.ts',
        start_line: 63,
        end_line: 64,
        title: 'Additive optional response field `avatarUrl` — existing callers unaffected, not a breaking change',
      },
    ],
    notes: 'Confirmed false positive: a naive reviewer flags any response-shape edit; this one is purely additive.',
  },
  {
    name: 'new-additive-route',
    inputDiff: `diff --git a/src/api/routes/payments.ts b/src/api/routes/payments.ts
--- a/src/api/routes/payments.ts
+++ b/src/api/routes/payments.ts
@@ -24,3 +24,4 @@ export function registerPaymentRoutes(app: FastifyInstance) {
 app.get('/v1/payments/:id', getPayment);
 app.post('/v1/payments', createPayment);
 app.post('/v1/refunds', createRefund);
+app.get('/v1/payments/:id/receipt', getPaymentReceipt);`,
    inputFiles: ['src/api/routes/payments.ts'],
    inputMeta: {
      pr_title: 'Add GET /v1/payments/:id/receipt',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0007newroute',
    },
    expectedOutput: [
      {
        type: 'must_not_flag',
        file: 'src/api/routes/payments.ts',
        start_line: 27,
        end_line: 27,
        title: 'New additive GET route — no existing caller affected, not breaking',
      },
    ],
    notes: 'Confirmed false positive: a brand-new route is never a breaking change on its own.',
  },
  {
    name: 'deprecation-handled-correctly',
    inputDiff: `diff --git a/src/api/routes/legacy.ts b/src/api/routes/legacy.ts
--- a/src/api/routes/legacy.ts
+++ b/src/api/routes/legacy.ts
@@ -7,6 +7,9 @@ export function registerLegacyRoutes(app: FastifyInstance) {
 export function registerLegacyRoutes(app: FastifyInstance) {
   app.post('/charge', (req, reply) => {
+    reply.header('Deprecation', 'true');
+    reply.header('Sunset', 'Wed, 01 Jan 2025 00:00:00 GMT');
     return legacyCharge(req, reply);
   });
+  app.post('/v2/charge', chargeV2);
 }`,
    inputFiles: ['src/api/routes/legacy.ts'],
    inputMeta: {
      pr_title: 'Deprecate /charge in favor of /v2/charge',
      repo: REPO_FULL_NAME,
      base: 'main',
      head_sha: 'eval0008deprecation',
    },
    expectedOutput: [
      {
        type: 'must_not_flag',
        file: 'src/api/routes/legacy.ts',
        start_line: 9,
        end_line: 13,
        title:
          'Deprecation handled correctly — old route aliased with Deprecation/Sunset headers, new v2 route added additively',
      },
    ],
    notes:
      'Confirmed false positive: this is the deprecation-policy skill\'s own GOOD example — old contract still works, headers signal the sunset, removal is deferred to a later major version.',
  },
];
