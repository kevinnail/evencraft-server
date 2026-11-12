import express, { type ErrorRequestHandler } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { asyncHandler } from './lib/asyncHandler';
import healthRouter from './routes/health';

const app = express();

// Mounted before any body parser: better-auth's handler reads the raw request body itself.
const authHandler = toNodeHandler(auth);
app.all(
  '/api/auth/*',
  asyncHandler(async (req, res) => {
    await authHandler(req, res);
  }),
);

app.use('/health', healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
};
app.use(errorHandler);

export default app;
