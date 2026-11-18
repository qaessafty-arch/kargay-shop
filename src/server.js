import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Kargay shop running on http://localhost:${config.port}`);
  console.log(`Admin: http://localhost:${config.port}/admin`);
});

// Stop cleanly so SQLite (WAL mode) can flush its files.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
