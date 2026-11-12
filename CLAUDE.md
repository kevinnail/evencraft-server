# CLAUDE.md

We're building the app described in @SPEC.MD. Read that file for general architectural tasks or to double-check the exact database structure, tech stack or application architecture.

Keep your replies extremely concise and focus on conveying the key information. No unnecessary fluff, no long code snippets.

Whenever working with any third-party library or something similar, you MUST look up the official documentation to ensure that you're working with up-to-date information. Use the DocsExplorer subagent for efficient documentation lookup.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The backend for EvenCraft, an iOS app for a self-employed maker. The app is local first and complete without this server; the server adds one paid thing, a backup: accounts, a RevenueCat subscription, push of changed rows, a one-time pull on restore, and photos in S3. Not two-phone sync.

## Start here

1. **`SPEC.md`** is the source of truth for features, the API table, rules, env vars, and test standards.
2. **`docs/plans/pending/v2-backup-and-restore.md`** is the build plan. Its Status table says which slice is next. Build one slice at a time, in order. When a slice is built, tested, working on the phone, and committed in both repos, mark it Done there with the date and commit. Plans move to `docs/plans/completed/` once signed off.

## Two repos

Most slices change both this repo and the app at `../EvenCraft-App` (Expo, React Native, TypeScript, Zustand, `expo-sqlite`). The plan marks each piece of work **Server:** or **App:**. The app has its own `CLAUDE.md` with its rules; follow it when editing there.

**Before adding or editing any file in `../EvenCraft-App`, check its branch (`git -C ../EvenCraft-App branch --show-current`). Continue only if it is `v2`.** On any other branch, make no changes there: stop, tell Kevin which branch it's on, and ask what he wants to do.

## Copy Crop Planner, don't redesign

This server is Kevin's Crop Planner server copied and renamed. Crop Planner is live in the App Store with paying subscribers, so its auth, subscription, push, pull, and photo code is proven. Before writing any pattern, read the Crop Planner file the plan names and copy it. Where EvenCraft differs, the plan's "What's different from Crop Planner" section says how.

- Server: `../../Crop Planner/Crop Planner Server/crop-planner-server` (`src/app.ts`, `src/db/schema.ts`, `src/routes/sync.ts`, `src/routes/webhooks.ts`, `src/lib/auth.ts`, `src/lib/s3.ts`, `src/lib/email.ts`)
- Wire shape: `crop-planner-server/backend-starter/SYNC-WIRE-CONTRACT.md`
- Known gaps to fix during the copy: `crop-planner-server/backend-starter/BACKLOG.md`
- App half: `../../Crop Planner/Crop Planner App/garden-tracker/garden-tracker`

## Commands

```bash
npm run start:watch          # server under nodemon, reloads on edit
npm test                   # Vitest once
npm run test:watch         # Vitest, stays running
npm run test:coverage      # once, with coverage
npm test -- __tests__/Integration/health.test.ts   # one test file
npm test -- -t "name"      # tests matching a name
npm run lint               # also lint:fix
npm run format:check       # also format
npm run typecheck          # tsc --noEmit
npm run build              # tsc to dist/; npm start runs it
```

```bash
npm run db:generate        # SQL diff from src/db/schema.ts into drizzle/
npm run db:apply-schema    # apply drizzle/ to the database in .env
```

The test database is never set up by hand. `__tests__/globalSetup.ts` drops every table in `evencraft_test` and applies `drizzle/` fresh before each test run (and each rerun in `test:watch`). Between tests, `resetDb` in `__tests__/helpers/db.ts` truncates. The rebuild refuses any database whose name doesn't end in `_test`. Railway applies the schema before each deploy (`preDeployCommand` in `railway.toml`).

Node 24 through nvm-windows. Local Postgres: `evencraft_dev` (`.env`) and `evencraft_test` (`.env.test`). The server scripts load `.env` with Node's `--env-file-if-exists` flag (no `.env` on Railway); Vitest loads `.env.test` from `vitest.config.mts`. No `.env.example`: this is a private business codebase, not one for others to set up.

Tests live in `__tests__/`: `Integration/` for HTTP plus the real database, `Unit/` for pure functions.

## Architecture

- `src/app.ts` builds the Express app; `src/server.ts` only listens, so Supertest imports the app without a port.
- Each resource is mounted once in `src/app.ts`: `/api/auth`, `/health`, `/webhooks`, `/sync`. Sub-routes live in that resource's router.
- better-auth (`/api/auth/*`) is mounted before `express.json()`, since its handler reads the raw body.
- Every `/sync` route runs session auth and `checkSubscription`. The `subscriptions` table, written only by RevenueCat's webhook, alone decides who is subscribed. A purchase with no expiry date counts as active.
- The webhook checks its secret in constant time before anything else; unknown event types answer 200.
- Six backed up tables: `supplies`, `pieces`, `breaks`, `work_segments`, `prep_uses`, `supply_uses`, in that order so each row's links arrive first on restore. Rows are keyed by account and `uuid`; the phone's integer ids are never stored. Links travel as `*_uuid` (mapping table in the plan). `pieces.kind_uuid` is a value, never checked against a row.
- Deletes are rows with `deleted_at` set. Pull returns only rows that aren't deleted.
- One active phone per account, by a phone id the app keeps in `settings`. The first push sets it, a pull (restore) moves it, and a push from any other phone gets 409 and changes nothing.
- The piece's photo S3 key lives on the `pieces` row. The server builds every key under the account's folder, caps photos at 15 MB, and deletes the old S3 object when a pushed row's photo changes or the piece is deleted.
- Every query is scoped to the signed in account.
- Timestamps are ISO 8601 UTC with milliseconds (`2026-11-08T14:03:21.487Z`), compared as text.

## Schema changes

Edit `src/db/schema.ts`, run `npm run db:generate`, read the generated SQL, then apply it. Never hand-edit files in `drizzle/`.

## Tests

Integration tests hit the real `evencraft_test` database, truncated between tests. Only Resend, RevenueCat, and S3 are mocked. Every route gets its golden path plus a failure case (bad input, no session, no subscription, wrong account, wrong phone), asserting on the response body and the database rows.

## Installing packages

Every install follows the 2 week rule for the whole dependency tree:

- Check publish dates with `npm view <pkg> time --json` (`npm view` ignores the cutoff below).
- Set the cutoff in the same command as the install: `export NPM_CONFIG_BEFORE=<current UTC time minus 14 days>`.
- After any install, `npm ls --all` shows nothing `invalid` or `missing`.
- npm 11 skips install scripts until approved. Approve only a package that needs its script, with `npm install-scripts approve <pkg>`.
