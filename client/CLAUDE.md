# client (`@devdigest/web`)

Next.js 15 / React 19 on :3000. pnpm.

## Before answering
Search `client/docs/`, `client/INSIGHTS.md`, and `client/README.md` for the topic
before reading code.

## Conventions (not obvious from code)
- `@devdigest/shared` is **vendored** at `src/vendor/shared/` and is a hand-kept
  copy of the server's; adding/changing a contract field means editing BOTH in
  lock-step. The only intended diffs are comments.
- `@devdigest/ui` and `@devdigest/shared` resolve via tsconfig path aliases to
  `src/vendor/*` — not npm packages.
- Components co-locate their `styles.ts`, `constants.ts`, `helpers.ts`, and
  `_components/` next to the component; PR-list grid columns are driven by `GRID`
  + `COLUMN_KEYS` in the page's `constants.ts` — keep them and the i18n
  `list.columns.*` keys aligned.
- Data fetching goes through the hooks in `src/lib/hooks/` (TanStack Query),
  not raw fetch in components.
- i18n: user-facing strings live in `messages/<locale>/<namespace>.json`; read via
  `useTranslations(namespace)`.

## Do-not-touch (without coordination)
- `src/vendor/shared/` and `src/vendor/ui/` — vendored; the server copy of
  `shared` must stay in sync.

## Use when
- Overview, commands → `client/README.md`
- UI component library → `client/src/vendor/ui/README.md`
- Deep-dives → `client/docs/` · gotchas/findings → `client/INSIGHTS.md`
- Commands: `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test`.
