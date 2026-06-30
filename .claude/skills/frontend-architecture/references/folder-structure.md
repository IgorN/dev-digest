# Folder structure

## Feature-first by default

- Organize **vertically by feature**, not horizontally by file type. Top-level
  `components/`, `hooks/`, `utils/` quickly become dumping grounds where unrelated
  code piles up. Push most code into `src/features/<feature>/`.
  ([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md), [Wieruch — feature architecture](https://www.robinwieruch.de/react-feature-architecture/))
- A feature folder mirrors `src/` internally (`api/`, `components/`, `hooks/`,
  `stores/`, `types/`, `utils/`) — but only include the subfolders the feature
  actually uses. ([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
- **Reserve top-level type folders for genuinely app-wide code:** `components`,
  `hooks`, `lib`, `utils`, `types`, `config`, `stores`, `testing`, `assets`.
  ([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))

## Grow the structure; don't design it upfront

The path from small to large ([Wieruch — folder structure](https://www.robinwieruch.de/react-folder-structure/)):

1. One file.
2. Multiple files (split a component into its own file when it becomes reusable).
3. A component **folder** once the component accrues styles/tests/constants/utils.
4. Technical folders (`hooks/`, `utils/`) for shared cross-component code.
5. Feature folders once features emerge.

Small projects can stop at step 2–3. Treat the structure as a guideline — folder/file
names are your choice. Avoid nesting component folders more than ~2 levels
(`list/list-item` ok; deeper is not).

## Dependency rules (what keeps it from rotting)

- **Unidirectional import flow:** `shared → features → app`. Shared code must never
  import from features or app. Enforce with ESLint `import/no-restricted-paths`.
  ([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
- **No cross-feature imports.** If feature A needs feature B, compose them at the
  app/page level instead of importing B into A. This keeps features independent and
  lets teams own slices in parallel. ([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md), [Wieruch — feature architecture](https://www.robinwieruch.de/react-feature-architecture/))

## Larger / multi-team apps: Feature-Sliced Design (FSD)

When loose feature folders start allowing circular deps, adopt FSD's stricter layering
([FSD layers](https://feature-sliced.design/docs/reference/layers), [FSD slices/segments](https://feature-sliced.design/docs/reference/slices-segments), [Developer Way](https://www.developerway.com/posts/react-project-structure)):

- **Layers** (top→bottom): `app`, `pages`, `widgets`, `features`, `entities`, `shared`.
  A layer may import **only from layers strictly below it**.
- **Slices** are named by **business domain** (`post`, `comments`, `auth`) — never by
  technical role.
- **Segments** inside a slice are technical: `ui`, `api`, `model` (business logic +
  stores), `lib`. Never name a segment `components`/`hooks`/`types`.
- **Entities vs features:** entities are what things *are* (data + basic ops); features
  are what users *can do* (actions). Don't mix them.
- Each slice exposes a single **public API** (`index`) — the only allowed import surface.
- Keep `shared` free of any business logic.

Migration tip: extract the `shared` layer first (common components/utils) — immediate
value, teaches the pattern. ([FSD layers](https://feature-sliced.design/docs/reference/layers))

## Barrel files

- **Avoid barrel `index.ts` re-export files in app/feature code** — they cause
  accidental circular imports and force synchronous loading of every re-exported
  module, hurting tree-shaking and startup. Import files directly; enable
  `import/no-cycle` if you keep any. ([TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files), [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
- The justified exceptions: a library/package's single public entry point, or FSD's
  enforced per-slice public API — a conscious tradeoff, not a default. ([TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files), [FSD slices/segments](https://feature-sliced.design/docs/reference/slices-segments))
