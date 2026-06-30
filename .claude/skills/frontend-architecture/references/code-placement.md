# Code placement — where non-component code lives

## utils vs helpers vs lib vs services

These are **conventions, not standards** — pick a set, document it, apply consistently
([Wieruch](https://www.robinwieruch.de/react-folder-structure/)). The accepted distinctions:

- **`utils/`** — generic, abstract, **project-agnostic** pure functions (formatters,
  ID generators, URL parsing). Would make sense in any codebase; no side effects.
  ([Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/), [Stephen Charles Weiss](https://stephencharlesweiss.com/utils-vs-helpers/))
- **`helpers/`** — utilities that only make sense inside **this project's domain**. If
  you wouldn't share it with another app, it's a helper, not a util.
  ([Stephen Charles Weiss](https://stephencharlesweiss.com/utils-vs-helpers/))
- **`lib/`** — "finished," library-grade modules, or **facades/wrappers around
  third-party packages** (your own API over `axios`) so a swap happens in one place.
  ([Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/), [Ali Bey](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f))
- **`services/`** — code with **side effects and external integrations**: API calls,
  DB, auth, third-party systems. Where application logic that touches the outside
  world lives. ([Ali Bey](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f), [Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/))

**Placement rule (all of the above):** keep it in the file that uses it; promote to a
feature folder when used across that feature; promote to top-level only when used
across features. Don't extract a central `utils/` prematurely — orphaned utils
accumulate when their only consumer is deleted. ([Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation), [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))

## Constants

- Keep a constant **local to the component** (top of the file) when used only there.
  Extract to a `constants.ts` (narrowest shared scope) only when reused or when it
  carries meaning. ([Austin Paley](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774))
- Centralize magic numbers/strings (API routes, config, repeated UI strings) for a
  single source of truth and to keep component bodies focused on behavior.
  ([Austin Paley](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774))
- Err toward **fewer** constants — extract only when it improves readability. In TS,
  use `as const` + type annotations to lock literal types. ([Austin Paley](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774))

## Types & interfaces (placement)

The 3-rule framework ([Total TypeScript — where to put types](https://www.totaltypescript.com/where-to-put-your-types-in-application-code)):

1. **Used once** → keep it in that file; inlining (no named alias) is fine and cheap
   to extract later. A component's **props type stays with the component**.
2. **Used in 2+ places** → move to a `*.types.ts` at the **narrowest** shared scope
   (`components.types.ts`, then `src/shared.types.ts`). Treat types like functions:
   extract only when shared.
3. **Shared across a monorepo** → a dedicated `packages/types`. A global `types/` dir
   should hold only framework-level plumbing, not feature types.

Default to `type`; reach for `interface` only when you need `extends`/declaration
merging. ([Total TypeScript — type vs interface](https://www.totaltypescript.com/type-vs-interface-which-should-you-use))

## Styles (colocation)

- Keep `Component.module.css` (CSS Modules, locally scoped) **next to** `Component.tsx`;
  reserve global CSS for resets and design tokens. ([Josh Comeau — file structure](https://www.joshwcomeau.com/react/file-structure/))
- With CSS-in-JS (styled-components / a `styles.ts`), define styles **in/next to the
  component file** so all styles that can apply — including context-dependent ones —
  are visible in one place ("every style is a component"). ([Josh Comeau — styled-components](https://www.joshwcomeau.com/css/styled-components/))
- Underlying rule: component + styles + types + helpers change together, so they live
  together. ([Josh Comeau](https://www.joshwcomeau.com/react/file-structure/), [Kent C. Dodds](https://kentcdodds.com/blog/colocation))

## Business / data logic

- Keep domain logic **out of JSX** — encapsulate fetching + stateful logic in custom
  hooks; framework/external integrations go in `lib`/`services`. ([patterns.dev — Hooks](https://www.patterns.dev/react/hooks-pattern/))
- Keep data functions **single-purpose** (`getPost`, `getComments`) over fat combined
  queries (`getPostWithComments`). ([Wieruch — feature architecture](https://www.robinwieruch.de/react-feature-architecture/))
- **Separate server-cache state from UI state** — manage server data with a dedicated
  tool (e.g. React Query), not the same mechanism as local `useState`. Don't reach for
  a global state library by default. ([Kent C. Dodds — App state management](https://kentcdodds.com/blog/application-state-management-with-react))

## Naming & files

- **kebab-case** for files/folders; keep names **singular** (`features/customer`,
  `customer-list`) even when the component renders a collection. ([Wieruch](https://www.robinwieruch.de/react-folder-structure/))
- Consistent suffixes (`name.module.css`, `Component.types.ts`, `Component.helpers.ts`)
  make fuzzy IDE search reliable. ([Wieruch](https://www.robinwieruch.de/react-folder-structure/), [Josh Comeau](https://www.joshwcomeau.com/react/file-structure/))
