# EvenCraft Server

Backend API for the EvenCraft iOS app: accounts, the backup subscription, backup and restore, and photo storage. See `SPEC.md` for what it does and `CLAUDE.md` for how it's built.

## Stack

Node 24, TypeScript strict, Express, Vitest and Supertest. Drizzle, Postgres, and better-auth arrive with the slices that need them.

## Local setup

1. Node 24 (nvm-windows).
2. Postgres installed locally, with the dev and test databases:

   ```bash
   createdb evencraft_dev
   createdb evencraft_test
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create `.env` and `.env.test` with the variables listed in `SPEC.md`. Both are gitignored. The server scripts load `.env`; tests load `.env.test`.

5. Run the server:

   ```bash
   npm run start:watch
   ```

## Scripts

| Command                           | What it does                                |
| --------------------------------- | ------------------------------------------- |
| `npm run build`                   | Compile TypeScript to `dist/`               |
| `npm start`                       | Run the compiled server from `dist/`        |
| `npm run start:watch`             | Server under nodemon, reloads on every save |
| `npm test`                        | Run the test suite once                     |
| `npm run test:watch`              | Run the tests and rerun them on every save  |
| `npm run test:coverage`           | Run the tests once with a coverage report   |
| `npm run typecheck`               | Typecheck without emitting                  |
| `npm run lint` / `lint:fix`       | ESLint                                      |
| `npm run format` / `format:check` | Prettier                                    |

Run one test file:

```bash
npm test -- __tests__/Integration/health.test.ts
```

## CI

`.github/workflows/ci.yml` runs lint, format check, typecheck, and tests on push and pull request to `main` and `dev`.
