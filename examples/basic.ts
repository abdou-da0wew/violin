import { createLogger, ConsoleTransport, FileTransport } from '@abdou-da0wew/violin';

const logger = createLogger({
  level: 'DEBUG',
  base: { service: 'example-worker' },
  transports: [
    new ConsoleTransport({ format: 'auto' }),
    new FileTransport({ directory: './logs', level: 'INFO' }),
  ],
});

const jobLogger = logger.child({ jobId: 'job_123' });
jobLogger.info('Job started');
jobLogger.warn('Retrying request', { attempt: 2, retryInMs: 500 });
await logger.close();
