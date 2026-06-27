# frontend-architecture

> **Version 1.0.2** (also in `SKILL.md` frontmatter). June 2026.

## Focus

The **structure and organization layer** of a React + Next.js (App Router) frontend:
*where* code lives and *how* it's split. It answers the everyday "where does this go?"
questions — components, sub-components, hooks, constants, utils/helpers, types, styles,
and business logic — and the bigger ones — feature-based vs type-based folders,
colocation, component splitting, and Next.js App Router layout.

## What it covers

- **Colocation** as the governing principle (place code near its use; promote only when shared).
- **Folder structure** — feature-first organization, top-level shared folders, no
  cross-feature imports, unidirectional import flow, scaling, and Feature-Sliced Design
  for larger apps.
- **Component organization** — splitting signals, presentational vs container, custom
  hooks as the modern container replacement, component-folder growth path.
- **Code placement** — `utils` vs `helpers` vs `lib` vs `services`; where constants,
  types/interfaces, and styles live; naming conventions; barrel-file tradeoffs.
- **Next.js App Router structure** — routing vs colocated code, private folders
  (`_components`), route groups `(group)`, the `src/` directory, and where the
  server/client (`'use client'`) boundary belongs architecturally.

## Designed for these cases

- Starting a new React/Next app and choosing a folder structure.
- Reviewing a PR and asking "should this constant/util/type be here or shared?"
- A component or file has grown too big and needs splitting.
- Deciding where business/data logic belongs vs the UI.
- Placing the Next.js `'use client'` boundary and organizing the `app/` tree.

## Relationship to other skills (what's different)

This skill is deliberately **narrow to structure/placement** to avoid overlap:

| Skill | Owns | This skill instead |
|---|---|---|
| `react-best-practices` | React component/hook/state **patterns & anti-patterns**, performance | *Where* components/hooks/state live and *how* to split them |
| `next-best-practices` | Next.js **feature behavior**: RSC data fetching, metadata, caching, route handlers | Next.js **folder/route structure** + where the client boundary sits |
| `typescript-expert` | The TypeScript **language** (types, generics, inference) | Only *where* types/interfaces should be **placed** |
| `react-testing-library` | How to **write** tests | Only that tests are **colocated** with the code they cover |

Rule of thumb: if the question is **"how do I write this?"** use the others; if it's
**"where does this go / how do I split this?"** use this skill.

## Layout

```
frontend-architecture/
├── SKILL.md                          # the actionable rules + quick "where does X go?" table
├── README.md                         # this file (focus, scope, relations, version, sources)
└── references/
    ├── folder-structure.md           # feature-first, shared folders, FSD, scaling, barrels
    ├── component-organization.md      # colocation, splitting, presentational/container, hooks
    ├── code-placement.md             # utils/helpers/lib/services, constants, types, styles, naming
    └── nextjs-app-router.md          # private folders, route groups, src/, server-client boundary
```

## Versioning

Bump the `version` in `SKILL.md` and note the change here when the guidance changes:

- **1.0.2** (2026-06) — Triggering tuned via a 16-query eval (`run_eval`, 2 runs
  each): added the "this project follows specific conventions — consult even for
  simple-looking placement questions" framing + explicit boundaries vs
  react-best-practices / next-best-practices / typescript-expert. Lifted should-
  trigger hits 2/8 → 4/8 while keeping 8/8 should-NOT-trigger (no false positives).
- **1.0.1** (2026-06) — Sharpened the `description` for more reliable triggering
  (concrete "where does X go / should I split this" user phrasings).
- **1.0.0** (2026-06) — Initial release. React + Next.js App Router architecture &
  code organization, synthesized from the sources below.

## Sources

Every link used in the research behind this skill. Kept verbatim for future updates.

### Foundational — colocation & state placement
- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation) — "place code as close to where it's relevant as possible"; tests/styles/comments placement + exceptions.
- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — push state down to where it's used; perf + maintainability rationale.
- [Application State Management with React — Kent C. Dodds](https://kentcdodds.com/blog/application-state-management-with-react) — local vs context vs server-cache state; avoid premature global state.
- [Thinking in React — react.dev](https://react.dev/learn/thinking-in-react) — component hierarchy mirrors the data model; static-first; minimal state and where it lives.

### React architecture & folder structure
- [bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature-based `src/` layout, unidirectional imports, no cross-feature imports, anti-barrel stance.
- [React Folder Structure in 5 Steps [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — incremental growth from one file → feature folders; kebab-case, singular names.
- [Feature-based React Architecture — Robin Wieruch](https://www.robinwieruch.de/react-feature-architecture/) — what a feature folder holds; single-purpose data functions; compose at the parent.
- [React project structure for scale — Developer Way](https://www.developerway.com/posts/react-project-structure) — layered decomposition (design system / shared / features / app) and dependency management.
- [Feature-Sliced Design — Overview](https://feature-sliced.design/) — methodology organizing the frontend by business value (Layers → Slices → Segments).
- [Feature-Sliced Design — Layers](https://feature-sliced.design/docs/reference/layers) — the standardized layers and the import-only-from-below rule.
- [Feature-Sliced Design — Slices and Segments](https://feature-sliced.design/docs/reference/slices-segments) — business-named slices, technical segments (`ui/api/model/lib`), per-slice public API.

### Component organization & splitting
- [Container/Presentational Pattern — patterns.dev](https://www.patterns.dev/react/presentational-container-pattern/) — separate "what data is shown" from "how it's shown".
- [Hooks Pattern — patterns.dev](https://www.patterns.dev/react/hooks-pattern/) — custom hooks replace most container components for stateful/business logic.
- [Single Responsibility Principle in React — cekrem](https://cekrem.github.io/posts/single-responsibility-principle-in-react/) — "one reason to change"; the "and" test for splitting.
- [Applying SRP to a React App — DhiWise](https://www.dhiwise.com/post/building-react-apps-with-the-single-responsibility-principle) — signs a component is too big; refactor into hooks + presentational/container.

### Code placement — utils/helpers/lib/services, constants, types, styles, naming
- [Where To Put Your Types in Application Code — Total TypeScript](https://www.totaltypescript.com/where-to-put-your-types-in-application-code) — colocate single-use types, `*.types.ts` for shared, dedicated package for monorepos.
- [Type vs Interface: Which Should You Use? — Total TypeScript](https://www.totaltypescript.com/type-vs-interface-which-should-you-use) — default to `type`, use `interface` for `extends`/declaration merging.
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/) — per-component folders colocating `.types.ts`/`.helpers.ts`/styles/sub-components.
- [The styled-components Happy Path — Josh W. Comeau](https://www.joshwcomeau.com/css/styled-components/) — colocate styles in the component file ("every style is a component").
- [Please Stop Using Barrel Files — TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files) — barrel `index.ts` files cause circular imports + load overhead; only at a library's public entry.
- [Libs vs Utils vs Services Folders — Ali Bey](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f) — accepted distinctions between utils, lib, and services.
- [utils vs helpers — Stephen Charles Weiss](https://stephencharlesweiss.com/utils-vs-helpers/) — utils are generic/abstract; helpers are project-specific.
- [How To Structure React Projects — Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/) — utils (pure fns), lib (third-party facades), services (external-API code).
- [How to Add a Constants File to Your React Project — Austin Paley](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774) — when to centralize constants; `as const` for literal types.

### Next.js (App Router) structure
- [Project structure and organization — Next.js docs](https://nextjs.org/docs/app/getting-started/project-structure) — all folder/file conventions, colocation, private folders, route groups, src, the 3 strategies.
- [Route Groups — Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) — `(group)` convention, multiple root layouts, caveats.
- [src Folder — Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) — moving `app`/`pages` under `src/`; what stays at root; tsconfig/Tailwind adjustments.
- [Server and Client Components — Next.js docs](https://nextjs.org/docs/app/getting-started/server-and-client-components) — the `'use client'` boundary; moving it down the tree; provider placement.
- [layout — Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/layout) — root layout requirements and nested layouts.
- [Composition Patterns — Next.js docs](https://nextjs.org/docs/14/app/building-your-application/rendering/composition-patterns) — interleaving Server/Client Components; children/props slot technique.
- [Server vs Client Components: Drawing the Right Boundary — Raghuveer](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/) — where the client boundary should architecturally live.
- [Reusable Architecture for Large Next.js Applications — freeCodeCamp](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/) — feature-oriented layout for large App Router apps.
- [Best Practices for Organizing Your Next.js 15 (2025) — DEV](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji) — `src/`-based layout with `components/ui`, `lib`, `hooks`, `features`; anti-patterns.
- [App Router Directory Design: Project Structure Patterns — DEV](https://dev.to/pipipi-dev/app-router-directory-design-nextjs-project-structure-patterns-31eo) — directory patterns combining route groups, private folders, feature colocation.
