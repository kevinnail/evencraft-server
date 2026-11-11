import express, { type ErrorRequestHandler } from 'express';
import healthRouter from './routes/health';

const app = express();

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
