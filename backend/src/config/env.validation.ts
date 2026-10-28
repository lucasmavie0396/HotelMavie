const REQUIRED_KEYS = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Variaveis de ambiente em falta: ${missing.join(', ')}`);
  }
  if (config.JWT_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET e JWT_REFRESH_SECRET tem de ser diferentes');
  }
  return config;
}
