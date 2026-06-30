---
name: frontend-architecture
description: >-
  Frontend UI architecture & code-organization conventions for this React + Next.js
  (App Router) codebase — the STRUCTURE & PLACEMENT layer. Consult this skill for
  ANY "where should this live?" or "how should I split / organize this?" decision —
  even ones that look simple enough to answer off the top of your head — because the
  project follows specific conventions worth applying instead of a generic guess.
  Covers: folder structure (feature-based vs type-based), colocation, when & how to
  split a component, and where to put components, hooks, constants, utils vs helpers
  vs lib vs services, types, styles, and business/data logic; plus Next.js App
  Router structure — private folders (`_components`), route groups `(group)`, the
  `src/` dir, and where the `'use client'` boundary belongs. Trigger it on phrasings
  like "where do I put this constant / util / helper / type", "is this component too
  big — should I split it", "lib vs services vs utils", "should this be shared or
  feature-local", "how should I structure this folder / feature", "where does the
  data-fetching logic go", or "how do I organize this Next.js app". Boundary: for how
  to WRITE React components/hooks/state and for perf/anti-patterns use
  react-best-practices; for Next.js runtime behavior (RSC data fetching, caching,
  metadata) use next-best-practices; for the TypeScript language itself use
  typescript-expert.
version: 1.0.2
---

# Frontend UI Architecture

Decide **where code lives** and **how it's split** in a React / Next.js codebase.
This skill is about structure and organization — not how to write the code itself.
See [README.md](README.md) for scope, related skills, and every source behind these rules.

## The one principle: colocation

**Place code as close to where it's used as reasonable. Things that change together
live together.** Everything below is an application of this. Promote code "up" to a
shared location only when it's actually shared — never preemptively. (Premature
extraction creates orphaned utils when their only consumer is deleted.)

## Where does this go? (quick reference)

| Thing | Used in ONE place | Used in 2+ places |
|---|---|---|
| Component | colocate next to its parent / in the route folder | `src/components/` (shared) |
| Sub-component | inline, then its own file when reused, then its own folder when it gains styles/tests | — |
| Custom hook | next to the component, or the feature's folder | `src/hooks/` |
| Constant | top of the file that uses it | `constants.ts` at the narrowest shared scope |
| Type / interface | inline or in the component file (props type stays with the component) | `*.types.ts` at the narrowest shared scope |
| util / helper | in the file that uses it | `utils/` (generic) or `helpers/` (project-specific) — see below |
| Business / data logic | a custom hook or a `lib`/`services` module — **never inside JSX** | same |
| Styles | next to the component (`Component.module.css` / `styles.ts`) | global CSS only for resets/tokens |
| Test | next to the file it tests | — |

Detail: [code-placement.md](references/code-placement.md).

## Folder structure: feature-first

- **Default to feature-based (vertical) organization**, not type-based dumping grounds.
  Most code lives in `src/features/<feature>/`; the feature folder mirrors `src/`
  internally (`components/`, `hooks/`, `api/`, `types/`, …) but only the parts it needs.
- **Reserve top-level type folders** (`components/`, `hooks/`, `lib/`, `utils/`,
  `types/`, `config/`) for genuinely app-wide shared code.
- **Don't design the perfect tree upfront.** Grow it: one file → files → component
  folder (when it gains styles/tests/constants) → feature folder. Small apps can skip
  features entirely.
- **No cross-feature imports.** If feature A needs feature B, compose them at the
  page/parent level. Enforce a unidirectional flow `shared → features → app`
  (ESLint `import/no-restricted-paths`).
- Avoid deep nesting (~2 levels max). Names are your choice; keep them consistent
  (kebab-case files, singular folder names).

Detail + Feature-Sliced Design for larger apps: [folder-structure.md](references/folder-structure.md).

## Splitting components

- The component hierarchy should **mirror the data model** — one component per
  meaningful piece of data. Build a static props-only version first, add state after.
- **Split signals:** you describe it with "and"; it manages multiple *unrelated*
  pieces of state; it fails the "one screen" scroll test; it's hard to test without
  heavy mocking; you can't state its purpose in one sentence.
- **Separate "what data" from "how it looks":** keep view components presentational
  (props-only, stateless, reusable); pull data-fetching/stateful logic into a
  **custom hook** (the modern replacement for container components).
- Don't over-split into "component confetti" — maximize cohesion, not file count.

Detail: [component-organization.md](references/component-organization.md).

## Business logic placement

- Keep domain logic **out of JSX**. Encapsulate fetching + stateful logic in custom
  hooks; put framework/external integrations in `lib`/`services`.
- Keep data functions **single-purpose** (`getPost`, `getComments`) over fat combined
  queries.
- **Separate server-cache state from UI state** — manage server data with a dedicated
  tool (e.g. React Query), not the same mechanism as local `useState`.
- Don't reach for global state by default: colocated `useState` + scoped context
  usually suffice.

## Barrel files (`index.ts`)

- **Avoid barrel re-export files in app/feature code** — they cause accidental circular
  imports and hurt bundler tree-shaking/startup. Import files directly.
- The legitimate exception: a library/package's single public entry point, or a
  deliberately-enforced per-slice public API (Feature-Sliced Design). A conscious
  tradeoff, not a default.

## Next.js App Router structure

- `app/` is for **routing**; a segment is only public once it has `page`/`route`.
  Everything else colocated in a segment is safe and never ships to the client.
- Use **private folders** (`_components`, `_lib`) to keep non-route code beside routes
  and out of routing. Use **route groups** `(group)` to share a layout / partition
  root layouts without affecting the URL.
- Default to **Server Components**; push `'use client'` to interactive **leaf** files —
  it cascades to everything it imports, so keep the boundary deep. Pass Server
  Components as `children` into Client Components; place providers as low as possible.
- Optionally put app code under `src/` (keep config + `public/` at root; update
  tsconfig `paths` and Tailwind `content`).

Detail: [nextjs-app-router.md](references/nextjs-app-router.md).

## When NOT to over-apply

Architecture serves the team, not vice versa. Small project? Skip features, skip
container/presentational, skip slices. Add structure when the pain appears (a flat
folder of 200 files, a component you can't describe in one sentence), not before.
