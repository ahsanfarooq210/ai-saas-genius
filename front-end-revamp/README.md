# front-end-revamp

React + TypeScript + Vite frontend, styled with Tailwind and shadcn/ui components.

## Running locally

```bash
pnpm install
pnpm dev
```

This project uses **pnpm**, not npm (there's a `pnpm-lock.yaml`, not a `package-lock.json`).

Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` to point at the backend (defaults to `http://localhost:8000`).

## Folder structure

```
src/
  api/            Typed HTTP client — one function per backend endpoint. No React.
  features/       Cross-cutting app logic: context providers, hooks, route guards.
  screens/        The actual UI + local state for each route, organized by domain.
  pages/          Thin route-level wrappers. One per route. No logic.
  components/ui/  Generic shadcn/ui design-system primitives (Button, Card, Input, ...).
  lib/            Small stateless helpers shared across the app (cn(), error parsing, ...).
```

The rule of thumb: **`pages/` wires up routes, `screens/` holds the real component, `features/` holds logic that isn't UI at all.** Nothing else should contain business logic.

### `pages/` — route wrappers, nothing else

Each file in `pages/` corresponds to one route registered in `App.tsx`. A page does exactly one thing: re-export the screen that renders for that route. It should never contain JSX, state, or handlers of its own — if you need to change what a route looks like or does, you're editing the matching file in `screens/`, not the page.

```ts
// src/pages/LoginPage.tsx
export { LoginScreen as LoginPage } from "@/screens/auth/LoginScreen"
```

That's the whole file. `App.tsx` imports `LoginPage` from `@/pages/LoginPage` — the re-export means the route wiring never has to know or care that the real component lives under `screens/auth/`. If a route ever needs route-specific wrapping (e.g. a layout, a `<Suspense>` boundary), that wrapping goes in the page file — the screen itself stays layout-agnostic.

### `screens/` — the real component

This is where the actual page lives: JSX, `useState`, form handlers, calls into `features/` and `api/`. Screens are organized **by domain**, one subfolder per feature area. Right now there's only one domain folder:

```
screens/
  auth/
    LoginScreen.tsx
    SignupScreen.tsx
  DashboardScreen.tsx
```

`LoginScreen` and `SignupScreen` live under `screens/auth/` because they're both part of the auth flow. `DashboardScreen` isn't part of any domain grouping yet, so it sits directly under `screens/`. As the app grows, add a new subfolder per domain (e.g. `screens/billing/`, `screens/settings/`) rather than letting `screens/` become a flat pile of unrelated files.

### `features/` — logic, not UI

`features/` holds state and behavior that more than one screen needs, or that isn't tied to any single screen at all — context providers, custom hooks, route guards. Nothing in here renders a full page.

```
features/
  auth/
    auth-context.ts    React context object + the useAuth() hook that reads it
    AuthProvider.tsx   The provider component: owns session state, calls the API,
                       exposes signIn/signUp/logout
    route-guards.tsx   <RequireAuth /> and <RedirectIfAuthenticated /> — used in
                       App.tsx's route config to gate access by auth state
```

`auth-context.ts` and `AuthProvider.tsx` are split into two files on purpose: a file that exports a React component can only export components (that's what makes Fast Refresh work), so the context object and the `useAuth()` hook live in a plain `.ts` file, and the `<AuthProvider>` component that owns the actual state lives in its own `.tsx` file. Screens and pages never touch `AuthProvider` directly — they call `useAuth()` from `auth-context.ts`.

`route-guards.tsx` is also `features/auth`, not `screens/auth`, because a route guard isn't a page — it renders nothing itself, it decides whether to render its child route (via `<Outlet />`) or redirect.

### `api/`

Pure HTTP layer — axios calls in, typed responses out, no React. `api/auth/auth.api.ts` has `signUp`, `logIn`, `logout`, etc.; `api/client.ts` configures the shared axios instance (cookies, CSRF header attachment, 401 refresh retry). Screens call these functions indirectly through `features/auth`, not directly, so that session state stays in one place.

### `components/ui/`

Generic, app-agnostic shadcn/ui primitives (`Button`, `Card`, `Field`, ...). These don't know about auth, routing, or any specific screen — they're building blocks that any screen can compose.

## Adding a new route

1. Build the screen in `screens/<domain>/<Name>Screen.tsx` (or directly under `screens/` if it doesn't belong to a domain yet).
2. Add a one-line re-export in `pages/<Name>Page.tsx`.
3. Register the route in `App.tsx`, wrapping it in `<RequireAuth />` or `<RedirectIfAuthenticated />` from `features/auth/route-guards` as appropriate.
