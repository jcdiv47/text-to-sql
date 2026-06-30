# Authentication and routing spec

## Status

Implemented / current state.

## Goal

Keep the landing page public while requiring Clerk authentication for chat and API access.

## Relevant files

- `app/layout.tsx`
- `app/page.tsx`
- `app/chat/page.tsx`
- `app/sign-in/[[...sign-in]]/page.tsx`
- `app/sign-up/[[...sign-up]]/page.tsx`
- `proxy.ts`
- `app/api/chat/route.ts`

## Current behavior

### App provider

`app/layout.tsx` wraps the app in `ClerkProvider` with:

- `dynamic`
- `signInUrl="/sign-in"`
- `signUpUrl="/sign-up"`
- dark Clerk theme

The root `<html>` element always has `className="dark"`.

`ConvexClientProvider` is mounted inside `ClerkProvider`, so Convex receives the active Clerk session for thread and message queries.

### Public landing page

`app/page.tsx` is a client component.

- Shows **Sign in** and **Sign up** buttons when `useAuth().isSignedIn` is false.
- Shows `UserButton` when signed in.
- Provides a **Go to Chat** link to `/chat`.

### Embedded Clerk pages

- `/sign-in` renders Clerk `<SignIn>` with `path="/sign-in"`, `routing="path"`, and `signUpUrl="/sign-up"`.
- `/sign-up` renders Clerk `<SignUp>` with `path="/sign-up"`, `routing="path"`, and `signInUrl="/sign-in"`.

### Protected routes

`proxy.ts` uses Clerk middleware and protects:

- `/chat(.*)`
- `/api(.*)`

If a protected request has no `userId`, the user is redirected to `/sign-in?redirect_url=<original-url>`.

### API defense in depth

`app/api/chat/route.ts` also calls `auth()` and returns `401 Unauthorized` if `userId` is missing. In normal Next.js routing, `proxy.ts` redirects unauthenticated `/api/*` requests before this handler runs; the route-level 401 protects the handler if the proxy is bypassed, disabled, or invoked directly.

## Requirements

- The app must allow unauthenticated access to `/`.
- The app must block unauthenticated access to `/chat`.
- The app must block unauthenticated access to all `/api/*` routes.
- Proxy redirects to sign-in must preserve the original URL using `redirect_url`.
- `/api/chat` must return `401` if the route handler is reached without an authenticated user.
- Auth UI must use the embedded `/sign-in` and `/sign-up` routes.

## Edge cases

- If Clerk has not loaded on the client, landing auth controls may render according to Clerk's current hook state.
- If a user changes accounts on a shared browser, chat history scoping is enforced by Convex auth and `app/assistant.tsx` waits for the signed-in user's Convex thread list before rendering a thread.
- Static assets and Next.js internals are excluded from the proxy matcher.

## Manual verification

- Visit `/` signed out: page loads and shows sign-in/sign-up controls.
- Visit `/chat` signed out: redirects to `/sign-in` with `redirect_url`.
- Sign in from redirected page: returns to the intended route.
- POST `/api/chat` signed out through normal app routing: redirects to `/sign-in` with `redirect_url`.
- Invoke the `/api/chat` route handler without a proxy-provided user: receives HTTP 401.
- Visit `/chat` signed in: assistant UI renders.
