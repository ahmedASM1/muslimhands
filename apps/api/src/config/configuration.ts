export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  appUrl: string;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  mail: {
    from: string;
    fromName: string;
    replyTo?: string;
    resendApiKey?: string;
    smtpHost?: string;
    smtpPort: number;
    smtpUser?: string;
    smtpPass?: string;
  };
}

const PLACEHOLDER_MARKERS = ['change-me', 'changemenow', 'replace_me', 'replace-me'];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function assertProductionSecurity(config: AppConfig) {
  if (config.nodeEnv !== 'production') {
    return;
  }

  if (!process.env.WEB_ORIGIN?.trim()) {
    throw new Error('WEB_ORIGIN is required in production');
  }
  if (config.webOrigin === '*' || config.webOrigin.trim() === '') {
    throw new Error('WEB_ORIGIN must be an explicit origin in production (not *)');
  }
  if (!process.env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is required in production');
  }
  if (config.jwt.accessSecret.length < 32 || looksLikePlaceholder(config.jwt.accessSecret)) {
    throw new Error('JWT_ACCESS_SECRET must be a strong non-placeholder secret (≥ 32 chars)');
  }
  if (config.jwt.refreshSecret.length < 32 || looksLikePlaceholder(config.jwt.refreshSecret)) {
    throw new Error('JWT_REFRESH_SECRET must be a strong non-placeholder secret (≥ 32 chars)');
  }
  if (config.jwt.accessSecret === config.jwt.refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
}

export function loadConfiguration(): AppConfig {
  const config: AppConfig = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 3001),
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    appUrl: process.env.APP_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    jwt: {
      accessSecret: required('JWT_ACCESS_SECRET'),
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshSecret: required('JWT_REFRESH_SECRET'),
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
      issuer: process.env.JWT_ISSUER ?? 'muslimhands-api',
      audience: process.env.JWT_AUDIENCE ?? 'muslimhands-web',
    },
    mail: {
      from: process.env.EMAIL_FROM ?? process.env.MAIL_FROM ?? 'noreply@localhost',
      fromName:
        process.env.EMAIL_FROM_NAME ?? 'Muslim Hands Medicine Distribution System',
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      resendApiKey: process.env.RESEND_API_KEY || undefined,
      smtpHost: process.env.SMTP_HOST || undefined,
      smtpPort: Number(process.env.SMTP_PORT ?? 587),
      smtpUser: process.env.SMTP_USER || undefined,
      smtpPass: process.env.SMTP_PASS || undefined,
    },
  };

  assertProductionSecurity(config);
  return config;
}
