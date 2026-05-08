import { createApp } from './app.js';

const app = createApp();

app.start().catch((err) => {
  console.error('Failed to start app:', err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  try {
    await app.stop();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
