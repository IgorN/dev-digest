# Component organization & splitting

## Colocation (the default)

- **Place code as close to where it's relevant as possible — things that change
  together live together.** ([Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation))
- Keep unit **tests** in the same folder as the module they test (not a mirrored
  `test/` tree); they double as documentation. ([Colocation](https://kentcdodds.com/blog/colocation))
- Keep explanatory **comments** and component **styles** next to the component.
  ([Colocation](https://kentcdodds.com/blog/colocation))
- Exceptions: integration tests sit in the folder grouping the related modules;
  end-to-end tests live at the project root (they span systems); a README can sit in
  the folder grouping a flow's modules. ([Colocation](https://kentcdodds.com/blog/colocation))
- **Colocate state** too: keep it in the component that uses it; lift only when
  genuinely shared, and push it back **down** when possible — closer state means a
  smaller re-render scope. ([State colocation](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster), [App state management](https://kentcdodds.com/blog/application-state-management-with-react))

## Designing the component hierarchy

- Draw boxes around every component/subcomponent in the mockup so the **hierarchy
  mirrors the data model** — one component per meaningful piece of data.
  ([Thinking in React](https://react.dev/learn/thinking-in-react))
- Build a **static, props-only** version first (no state); add interactivity after.
  ([Thinking in React](https://react.dev/learn/thinking-in-react))
- **Derive state instead of storing it** — keep state minimal and compute the rest on
  demand. ([Thinking in React](https://react.dev/learn/thinking-in-react))

## When to split a component

Split signals ([cekrem — SRP](https://cekrem.github.io/posts/single-responsibility-principle-in-react/), [DhiWise — SRP](https://www.dhiwise.com/post/building-react-apps-with-the-single-responsibility-principle)):

- You describe it with **"and"** (it does X *and* Y) → one component, one reason to change.
- It manages **multiple unrelated** pieces of state.
- It fails the **scroll test** (can't see it on one screen).
- It's **hard to test** without heavy mocking.
- You **can't state its purpose** in one sentence.

Growth path ([Wieruch](https://www.robinwieruch.de/react-folder-structure/)): extract a
subcomponent into its own **file** when it becomes reusable; into its own **folder**
once it accrues styles/tests/constants/utils.

## Separate "what" from "how"

- Keep **presentational** components props-only, stateless, reusable ("how it looks").
  Pull "what data is shown" — fetching, stateful logic — out of them.
  ([patterns.dev — Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/))
- **Prefer a custom hook over a container component** for that separation in modern
  React — a hook (`useUser`, `usePosts`) encapsulates fetching/logic with no wrapper
  component and less boilerplate. The separation principle survives; the container
  layer mostly doesn't. ([patterns.dev — Hooks](https://www.patterns.dev/react/hooks-pattern/), [DhiWise](https://www.dhiwise.com/post/building-react-apps-with-the-single-responsibility-principle))
- Refactor a too-big component by extracting each responsibility: data → custom hook,
  presentation → view component, along state boundaries. ([DhiWise](https://www.dhiwise.com/post/building-react-apps-with-the-single-responsibility-principle))

## Don't over-do it

- No container/presenter pair for a 10-line submit button. ([patterns.dev](https://www.patterns.dev/react/presentational-container-pattern/))
- Avoid "component confetti" — the goal is components that change together staying
  together, not the maximum number of files. ([DhiWise](https://www.dhiwise.com/post/building-react-apps-with-the-single-responsibility-principle))
