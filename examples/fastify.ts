import Fastify from 'fastify';
import { createLogger } from '@abdou-da0wew/violin';
import { createFastifyLogger } from '@abdou-da0wew/violin/fastify';

const violin = createLogger({ level: 'INFO', base: { service: 'example-api' } });
const app = Fastify({ loggerInstance: createFastifyLogger(violin) });

app.get('/health', async () => ({ ok: true }));

try {
  await app.listen({ host: '127.0.0.1', port: 3000 });
} catch (error) {
  violin.fatal(error instanceof Error ? error : new Error(String(error)), 'Startup failed');
  await app.close();
  await violin.close();
  process.exitCode = 1;
}
