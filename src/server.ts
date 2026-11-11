import app from './app';

const PORT = Number(process.env.PORT ?? '7890');

app.listen(PORT, '0.0.0.0', () => {
  console.info(`Server running on port ${PORT.toString()}`);
});
