import 'dotenv/config';

const problems = [];
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const DURATION = /^\d+[smhd]$/;

function raw(name) {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function rangeText(min, max) {
  if (min !== -Infinity && max !== Infinity) return `between ${min} and ${max}`;
  if (min !== -Infinity) return `>= ${min}`;
  if (max !== Infinity) return `<= ${max}`;
  return '';
}

function int(name, def, { min = -Infinity, max = Infinity } = {}) {
  const v = raw(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer ${rangeText(min, max)} (got "${v}")`.replace('  ', ' '));
    return def;
  }
  return n;
}

function str(name, def) {
  return raw(name) ?? def;
}

function oneOf(name, def, allowed) {
  const v = raw(name);
  if (v === undefined) return def;
  if (!allowed.includes(v)) {
    problems.push(`${name} must be one of ${allowed.join(', ')} (got "${v}")`);
    return def;
  }
  return v;
}

function bool(name, def) {
  const v = raw(name);
  if (v === undefined) return def;
  if (['true', '1', 'yes'].includes(v.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(v.toLowerCase())) return false;
  problems.push(`${name} must be true or false (got "${v}")`);
  return def;
}

function duration(name, def) {
  const v = raw(name);
  if (v === undefined) return def;
  if (!DURATION.test(v)) {
    problems.push(`${name} must be a number followed by s, m, h or d, e.g. 15m (got "${v}")`);
    return def;
  }
  return v;
}

function list(name, def) {
  return (raw(name) ?? def).split(',').map((s) => s.trim()).filter(Boolean);
}

function url(name, def) {
  const v = raw(name) ?? def;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol');
    return v.replace(/\/+$/, '');
  } catch {
    problems.push(`${name} must be an http(s) URL (got "${v}")`);
    return def;
  }
}

function notAbove(smallName, small, bigName, big) {
  if (small > big) problems.push(`${smallName} (${small}) must not be greater than ${bigName} (${big})`);
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 4000, { min: 1, max: 65535 }),
  host: str('HOST', '0.0.0.0'),
  logLevel: oneOf('LOG_LEVEL', 'info', LOG_LEVELS),

  server: {
    http2: bool('HTTP2', false),
    tlsKey: str('TLS_KEY', null),
    tlsCert: str('TLS_CERT', null),
  },

  mongoUri: str('MONGO_URI', 'mongodb://127.0.0.1:27017/federix_central'),
  redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),

  db: {
    connectTimeoutMs: int('DB_CONNECT_TIMEOUT_MS', 3000, { min: 100 }),
    redisBackoffStepMs: int('REDIS_BACKOFF_STEP_MS', 200, { min: 0 }),
    redisMaxBackoffMs: int('REDIS_MAX_BACKOFF_MS', 2000, { min: 0 }),
    redisMaxRetriesPerRequest: int('REDIS_MAX_RETRIES_PER_REQUEST', 3, { min: 0 }),
  },

  jwt: {
    accessSecret: str('JWT_ACCESS_SECRET', 'dev_access_secret_change_me'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'),
    accessExpiresIn: duration('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: duration('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  security: {
    bcryptRounds: int('BCRYPT_ROUNDS', 10, { min: 4, max: 15 }),
    minSecretLength: int('MIN_SECRET_LENGTH', 32, { min: 16 }),
    minPasswordLength: int('MIN_PASSWORD_LENGTH', 8, { min: 6 }),
  },

  internalServiceToken: str('INTERNAL_SERVICE_TOKEN', 'dev_internal_service_token_change_me'),
  flServerIps: list('FL_SERVER_ALLOWED_IPS', '127.0.0.1,::1,::ffff:127.0.0.1'),

  storage: {
    dir: str('STORAGE_DIR', './storage'),
    publicBaseUrl: null,
    partialTtlSeconds: int('UPLOAD_PARTIAL_TTL_SECONDS', 86400, { min: 1 }),
    sweepIntervalMs: int('STORAGE_SWEEP_INTERVAL_MS', 3600000, { min: 100 }),
  },

  signedUrl: {
    secret: str('SIGNED_URL_SECRET', 'dev_signed_url_secret_change_me'),
    defaultTtlSeconds: int('SIGNED_URL_TTL_SECONDS', 600, { min: 1 }),
    uploadTtlSeconds: int('UPLOAD_URL_TTL_SECONDS', 900, { min: 1 }),
    maxLifetimeSeconds: int('SIGNED_URL_MAX_LIFETIME_SECONDS', 86400, { min: 1 }),
  },

  heartbeat: {
    checkIntervalMs: int('HEARTBEAT_CHECK_INTERVAL_MS', 30000, { min: 100 }),
    timeoutMs: int('HEARTBEAT_TIMEOUT_MS', 90000, { min: 100 }),
  },

  events: {
    pingIntervalMs: int('EVENT_PING_INTERVAL_MS', 30000, { min: 100 }),
    queueMax: int('EVENT_QUEUE_MAX', 1000, { min: 1 }),
    authRecheckMs: int('STREAM_AUTH_RECHECK_MS', 30000, { min: 100 }),
  },

  scheduler: {
    intervalMs: int('SCHEDULER_INTERVAL_MS', 1000, { min: 50 }),
    aggregationTimeoutSeconds: int('AGGREGATION_TIMEOUT_SECONDS', 900, { min: 1 }),
    watchKeepaliveMs: int('WATCH_KEEPALIVE_MS', 15000, { min: 100 }),
    flStatusStaleAfterMs: int('FL_STATUS_STALE_AFTER_MS', 60000, { min: 100 }),
  },

  clientStatus: {
    checkIntervalMs: int('CLIENT_STATUS_CHECK_INTERVAL_MS', 60000, { min: 100 }),
    idleAfterMs: int('CLIENT_IDLE_AFTER_MS', 300000, { min: 100 }),
    disconnectedAfterMs: int('CLIENT_DISCONNECTED_AFTER_MS', 1800000, { min: 100 }),
  },

  maintenance: {
    ttlSeconds: int('MAINTENANCE_TTL_SECONDS', 86400, { min: 1 }),
  },

  limits: {
    maxLabelClasses: int('MAX_LABEL_CLASSES', 1000, { min: 1 }),
    maxLabelKeyLength: int('MAX_LABEL_KEY_LENGTH', 64, { min: 1 }),
    pageSizeDefault: int('PAGE_SIZE_DEFAULT', 20, { min: 1 }),
    pageSizeMax: int('PAGE_SIZE_MAX', 200, { min: 1 }),
    metricsRoundsDefault: int('METRICS_ROUNDS_DEFAULT', 20, { min: 1 }),
    metricsRoundsMax: int('METRICS_ROUNDS_MAX', 200, { min: 1 }),
    clientMetricsScanFactor: int('CLIENT_METRICS_SCAN_FACTOR', 50, { min: 1 }),
    clientHistoryLimit: int('CLIENT_HISTORY_LIMIT', 50, { min: 1 }),
    configHistoryLimit: int('CONFIG_HISTORY_LIMIT', 100, { min: 1 }),
    logsLimitDefault: int('LOGS_LIMIT_DEFAULT', 100, { min: 1 }),
    logsLimitMax: int('LOGS_LIMIT_MAX', 500, { min: 1 }),
    selfMetricsLimitDefault: int('SELF_METRICS_LIMIT_DEFAULT', 10, { min: 1 }),
    selfMetricsLimitMax: int('SELF_METRICS_LIMIT_MAX', 100, { min: 1 }),
    utilityAvgWindow: int('UTILITY_AVG_WINDOW', 200, { min: 1 }),
    maxUpdateSizeMb: int('MAX_UPDATE_SIZE_MB', 256, { min: 1 }),
    maxModelSizeMb: int('MAX_MODEL_SIZE_MB', 1024, { min: 1 }),
  },

  requestMetrics: {
    windowMs: int('METRICS_WINDOW_MS', 60000, { min: 1000 }),
    maxSamples: int('METRICS_MAX_SAMPLES', 50000, { min: 100 }),
  },

  aggregationEstimate: {
    baseMs: int('AGGREGATION_BASE_MS', 5000, { min: 0 }),
    perUpdateMs: int('AGGREGATION_PER_UPDATE_MS', 800, { min: 0 }),
  },

  supportedSdkVersions: list('SUPPORTED_SDK_VERSIONS', '1.0.0,1.1.0'),
  serverTimezone: str('SERVER_TIMEZONE', 'Asia/Kolkata'),

  buildInfo: {
    apiVersion: 'v1',
    build: str('BUILD_ID', 'dev-local'),
  },
};

config.maxUpdateSizeMb = config.limits.maxUpdateSizeMb;
config.storage.publicBaseUrl = url('PUBLIC_BASE_URL', `http://127.0.0.1:${config.port}`);

notAbove('CLIENT_IDLE_AFTER_MS', config.clientStatus.idleAfterMs, 'CLIENT_DISCONNECTED_AFTER_MS', config.clientStatus.disconnectedAfterMs);
notAbove('PAGE_SIZE_DEFAULT', config.limits.pageSizeDefault, 'PAGE_SIZE_MAX', config.limits.pageSizeMax);
notAbove('METRICS_ROUNDS_DEFAULT', config.limits.metricsRoundsDefault, 'METRICS_ROUNDS_MAX', config.limits.metricsRoundsMax);
notAbove('LOGS_LIMIT_DEFAULT', config.limits.logsLimitDefault, 'LOGS_LIMIT_MAX', config.limits.logsLimitMax);
notAbove('SELF_METRICS_LIMIT_DEFAULT', config.limits.selfMetricsLimitDefault, 'SELF_METRICS_LIMIT_MAX', config.limits.selfMetricsLimitMax);
if (Boolean(config.server.tlsKey) !== Boolean(config.server.tlsCert)) {
  problems.push('TLS_KEY and TLS_CERT must be set together');
}

export function configProblems() {
  return [...problems];
}

export function assertValidConfig() {
  if (problems.length) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

export function insecureSecrets(cfg = config) {
  const minLength = cfg.security.minSecretLength;
  const secrets = {
    JWT_ACCESS_SECRET: cfg.jwt.accessSecret,
    JWT_REFRESH_SECRET: cfg.jwt.refreshSecret,
    INTERNAL_SERVICE_TOKEN: cfg.internalServiceToken,
    SIGNED_URL_SECRET: cfg.signedUrl.secret,
  };
  const found = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (!value || /change_me/i.test(value)) found.push(`${name} is still a default value`);
    else if (value.length < minLength) found.push(`${name} is shorter than ${minLength} characters`);
  }
  if (secrets.JWT_ACCESS_SECRET && secrets.JWT_ACCESS_SECRET === secrets.JWT_REFRESH_SECRET) {
    found.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  return found;
}

export function assertProductionSecrets(cfg = config) {
  if (cfg.env !== 'production') return;
  const found = insecureSecrets(cfg);
  if (found.length) {
    throw new Error(`Refusing to start in production with insecure secrets:\n  - ${found.join('\n  - ')}`);
  }
}
