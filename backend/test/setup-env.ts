import { testDatabaseUrl } from './test-database';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.SMTP_HOST = '';
process.env.JWT_SECRET ??= 'segredo-de-teste-access';
process.env.JWT_REFRESH_SECRET ??= 'segredo-de-teste-refresh';
