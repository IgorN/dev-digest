# Next.js App Router — structure & organization

All rules below are about *structure*, not data-fetching/feature behavior (that's
`next-best-practices`).

## `app/` is for routing; colocation is safe

- Folders in `app/` define **route segments**, but a route is only public once it has
  a `page.js`/`route.js`. Non-route files (components, helpers, tests) are safe to
  colocate inside a segment. ([project structure](https://nextjs.org/docs/app/getting-started/project-structure))
- Only what `page`/`route` returns ships to the client — colocated helpers never leak
  into the route. ([project structure](https://nextjs.org/docs/app/getting-started/project-structure))
- Colocation is optional: you may keep all app code outside `app/` and use `app/`
  purely for routing. ([project structure](https://nextjs.org/docs/app/getting-started/project-structure))
- Rendering order per segment: `layout` → `template` → `error` → `loading` →
  `not-found` → `page`/nested `layout`; layouts wrap all descendant segments.
  ([project structure](https://nextjs.org/docs/app/getting-started/project-structure), [layout](https://nextjs.org/docs/app/api-reference/file-conventions/layout))

## Private folders & route groups

- **Private folder** `_name` (e.g. `_components`, `_lib`) opts a folder (and its
  subfolders) **out of routing** — use it to separate UI/logic from routes and avoid
  clashes with future Next.js file conventions. (Need a literal `_` URL segment? use
  `%5F`.) ([project structure](https://nextjs.org/docs/app/getting-started/project-structure))
- **Route group** `(group)` organizes routes by team/section/feature **without
  affecting the URL**. Use it to give a subset of routes a shared `layout.js`, scope a
  `loading.js`, or define multiple root layouts. ([route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups))
- Caveats: two groups must not resolve to the same URL (`(a)/about` + `(b)/about` →
  error); navigating between **different root layouts** triggers a full page reload, so
  partition root layouts deliberately. For multiple root layouts, drop the top-level
  `layout.js`, add `<html>`/`<body>` to each group's layout, and define `/` inside one
  group. ([route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups))

## `src/` directory

- Move `app/` (and `components/`, `lib/`, …) under `src/` to separate app code from
  root config (`src/app` is ignored if a root `app/` also exists). ([src folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder))
- Keep `public/`, `package.json`, `next.config.js`, `tsconfig.json`, `.env.*` at the
  **project root** regardless. Update tsconfig `paths` (`@/*` → `src/`) and Tailwind
  `content` to include `/src`. ([src folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder))

## Shared vs feature-local code — pick one strategy

Choose one of the documented strategies and stay consistent ([project structure](https://nextjs.org/docs/app/getting-started/project-structure)):

1. App code in **root-level shared folders**; `app/` for routing only.
2. App code in **top-level folders inside `app/`**.
3. **Globally shared code in root**, feature-specific code split into the route
   segments that use it (feature-first; recommended default for large apps).
   ([freeCodeCamp](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/), [DEV — Next.js 15](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji))

Folder names (`components/`, `lib/`, `ui/`, `utils/`, `hooks/`, `styles/`) carry **no
framework meaning** — choose by team convention. Colocate feature-local code next to
its route (segment or `_folder`); promote to a shared root folder only when reused.
([project structure](https://nextjs.org/docs/app/getting-started/project-structure))

A common 2025 layout: `src/app/` (routes only), `src/components/ui/` (primitives),
`src/components/` (shared composites), `src/features/<feature>/`, `src/lib/`,
`src/hooks/`, `src/types/`, `src/styles/`. Subdivide `components/` (avoid a flat
200-file folder); split `lib/` by domain rather than one giant `utils.ts`; don't nest
6–7 levels deep. ([DEV — Next.js 15](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji), [DEV — directory design](https://dev.to/pipipi-dev/app-router-directory-design-nextjs-project-structure-patterns-31eo))

## The server/client boundary (by structure)

- Default everything to **Server Components**; add `'use client'` only at interactive
  **leaf** files (state, event handlers, browser APIs). ([server & client components](https://nextjs.org/docs/app/getting-started/server-and-client-components))
- `'use client'` **cascades** to every module it imports, so push it as **deep down**
  the tree as possible to minimize the client bundle. Extract an interactive widget
  into its own file and mark only that file. ([server & client components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Raghuveer](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/))
- Client Components **can't import** Server Components — pass Server Components as
  `children`/props into Client Components so they stay server-rendered. Place context
  **providers as deep as possible** (wrap only `{children}`, not `<html>`) so static
  server subtrees aren't dragged into the client graph. ([composition patterns](https://nextjs.org/docs/14/app/building-your-application/rendering/composition-patterns), [server & client components](https://nextjs.org/docs/app/getting-started/server-and-client-components))
