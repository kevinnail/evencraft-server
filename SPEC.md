# EvenCraft Server: SPEC

## What this is

The backend for EvenCraft, an iOS app for a self-employed maker (glass, mostly) that keeps a record of every piece made: what it is, when it was made, how long it actually took, what it cost, and a photo. The app's point is accountability: worked time against time that wasn't work, and output per day against hours worked per day.

The app is local first and complete without this server. Everything lives on the phone in SQLite, with photos as files in the app's documents folder. This server adds one paid thing: **a backup**. A maker who subscribes can delete the app, reinstall it, or move to a new phone and get everything back by signing in, a piece in progress included.

The app is in `../EvenCraft-App` (Expo, React Native, TypeScript, Expo Router, Zustand, `expo-sqlite`). Its `CLAUDE.md` has the app's rules.

## Where it comes from

This server is Kevin's Crop Planner server, copied and renamed, not redesigned. Crop Planner's backend is live in the App Store with paying subscribers, so its auth, subscription, push, pull, and photo code has been through App Review and real devices.

- Server source: `../../Crop Planner/Crop Planner Server/crop-planner-server`
- App source for the client half: `../../Crop Planner/Crop Planner App/garden-tracker/garden-tracker`

When a pattern is needed, read how Crop Planner does it first and copy it. Where EvenCraft differs, the plan says how.

## The plan

`docs/plans/pending/v2-backup-and-restore.md` is the build plan: the decisions, what's different from Crop Planner, and 11 vertical slices, each covering the server and the app. Its Status table says what's done and what's next. Build in its order, one slice at a time.

## Features

1. **Health check.** `GET /health` answers 200 with `{ status: "ok", timestamp }`.
2. **Accounts.** Email and password through better-auth: create an account, sign in, sign out, and reset a forgotten password by an emailed link that opens the app at `evencraft://reset-password`. Email through Resend.
3. **Subscription.** One yearly subscription bought in the app through RevenueCat (Apple in-app purchase), entitlement `premium`. RevenueCat's user id is the account's id. RevenueCat's webhook writes the `subscriptions` table, and that table alone decides who is subscribed. A purchase with no expiry date counts as active.
4. **Back up.** The phone pushes every row that changed since its last push that worked. Six tables: `supplies`, `pieces`, `breaks`, `work_segments`, `prep_uses`, `supply_uses`. Rows are keyed by account and `uuid`; links between rows travel as `uuid`s; deletes are rows with `deleted_at` set.
5. **One active phone per account.** The first push makes a phone active. A push from any other phone is refused with 409 and changes nothing. A restore makes the restoring phone the active one.
6. **Restore.** The phone pulls every row on the account that isn't deleted, once, on restore. The backup always wins over a phone's own data.
7. **Photos.** A piece's photo goes to a private S3 bucket through upload and download links the server signs. The server builds every key under the account's own folder, caps a photo at 15 MB, and deletes the old photo from S3 when a piece's photo changes or the piece is deleted.

Not part of this server: two-phone sync and merging, Stripe or any web checkout, a website, admin screens, feature flags.

## API

| Method | Path                       | Needs                      | What it does                                                     |
| ------ | -------------------------- | -------------------------- | ---------------------------------------------------------------- |
| GET    | `/health`                  | Nothing                    | Answers 200                                                      |
| ALL    | `/api/auth/*`              | Depends on the route       | better-auth: sign up, sign in, session, sign out, password reset |
| POST   | `/webhooks/revenuecat`     | RevenueCat's secret header | Writes the account's subscription                                |
| POST   | `/sync/push`               | Session and subscription   | Stores changed rows; 409 from a phone that isn't active          |
| GET    | `/sync/pull`               | Session and subscription   | Returns the account's rows; makes this phone active              |
| POST   | `/sync/image/upload-url`   | Session and subscription   | A signed link to upload one photo                                |
| POST   | `/sync/image/download-url` | Session and subscription   | A signed link to download one of the account's photos            |

The wire shape is Crop Planner's `backend-starter/SYNC-WIRE-CONTRACT.md`, with EvenCraft's tables, links, and active phone as the plan lays them out.

## Rules

- **Each resource is mounted once in `src/app.ts`:** `/api/auth`, `/health`, `/webhooks`, `/sync`. Routes under a prefix live in that resource's router.
- **better-auth is mounted before `express.json()`**, since its handler reads the raw body.
- **`src/app.ts` builds the app, `src/server.ts` listens**, so Supertest imports the app without binding a port.
- **Every `/sync` route requires a session and `checkSubscription`.** The app's own subscription check is never trusted.
- **The webhook secret is checked in constant time before anything else runs.** Unknown event types answer 200.
- **Every query is scoped to the signed in account.** No route reads or writes another account's rows or photos.
- **The server never stores the phone's integer ids.** Rows are keyed by account and `uuid`.
- **Timestamps are ISO 8601 UTC with milliseconds** (`2026-11-08T14:03:21.487Z`), the shape the app already writes, so they compare correctly as text.
- **Schema changes:** edit `src/db/schema.ts`, `npm run db:generate`, read the generated SQL, then apply it. Never hand-edit files in `drizzle/`.

## Tech stack

| Layer     | Technology                                                                   |
| --------- | ---------------------------------------------------------------------------- |
| Runtime   | Node 24 (nvm-windows), TypeScript strict                                     |
| Framework | Express                                                                      |
| Auth      | better-auth with `@better-auth/expo`                                         |
| ORM       | Drizzle (`drizzle-orm`, `drizzle-kit`), `postgres` driver                    |
| Database  | PostgreSQL. Local: `evencraft_dev` and `evencraft_test`. Production: Railway |
| Payments  | RevenueCat in front of Apple in-app purchase                                 |
| Email     | Resend                                                                       |
| Photos    | AWS S3, private bucket, signed links                                         |
| Tests     | Vitest and Supertest against the local test database                         |
| Lint      | ESLint and Prettier                                                          |
| Hosting   | Railway (API and Postgres)                                                   |

Package versions start from `crop-planner-server/package.json` and each one is checked against the 2 week rule below.

## Setup on day one

1. ESLint and Prettier, with `lint`, `lint:fix`, `format`, and `format:check` scripts.
2. `typecheck` (`tsc --noEmit`), TypeScript strict.
3. `.env` and `.env.test`, both gitignored. No `.env.example`: this is a private business codebase.
4. Vitest and Supertest with a passing health test before feature code. `test` runs once; `test:watch` stays running.
5. Local Postgres `evencraft_dev` connected, and `evencraft_test` for tests. `DATABASE_URL=postgresql://localhost:5432/evencraft_dev`.
6. CI on push running lint, format check, typecheck, and tests.
7. `.gitignore` and a README on running it locally.

Scripts also include `run:watch` under nodemon, so an edit reloads the server.

## Environment variables

```
PORT=
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
PASSWORD_RESET_REDIRECT_URL=evencraft://reset-password
REVENUECAT_WEBHOOK_AUTH_HEADER=
RESEND_API_KEY=
EMAIL_FROM=
AWS_REGION=
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

Each one arrives with the slice that needs it.

## Tests

- Integration tests hit the real local `evencraft_test` database, isolated by truncating between tests. No mocked data layer.
- Mocked only: Resend, RevenueCat, and S3.
- Every route gets its golden path and at least one failure case (bad input, no session, no subscription, wrong account, wrong phone).
- Assert on the response body and the rows in the database, not on a function having been called.
- Every test has a one sentence comment above it saying what breaks if it fails.

## Installing packages

Every install follows the 2 week rule for the whole dependency tree:

- Check publish dates with `npm view <pkg> time --json` first.
- Set the cutoff in the same command as the install: `export NPM_CONFIG_BEFORE=<current UTC time minus 14 days>`.
- After any install, `npm ls --all` shows nothing `invalid` or `missing`.
- npm 11 skips install scripts until approved. Approve only a package that needs its script, with `npm install-scripts approve <pkg>`.

## Styling

The server has no pages. The app's screens for this work (the Backup screen and its forms) use the app's existing styles in `../EvenCraft-App/src/theme.ts` and look like the rest of the app.
