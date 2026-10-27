// Host configuration: defaults ← host.config.json ← KNOCKON_* env.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface HostConfig {
  port: number;
  dataDir: string;
  staticDir: string | null;
  maxPlayers: number;
  autosaveSeconds: number;
  compactEveryOps: number;
  backups: { keep: number; everyMinutes: number };
  maxUploadMB: number;
  countdownMs: number;
  lockIdleMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const DEFAULTS: HostConfig = {
  port: 8787,
  dataDir: './data',
  staticDir: './apps/game/dist',
  maxPlayers: 2,
  autosaveSeconds: 10,
  compactEveryOps: 5000,
  backups: { keep: 20, everyMinutes: 10 },
  maxUploadMB: 256,
  countdownMs: 3000,
  lockIdleMs: 10_000,
  logLevel: 'info',
};

export function loadConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): HostConfig {
  let fileCfg: Partial<HostConfig> = {};
  for (const name of ['host.config.local.json', 'host.config.json']) {
    const p = resolve(cwd, name);
    if (existsSync(p)) {
      fileCfg = JSON.parse(stripJsonComments(readFileSync(p, 'utf8'))) as Partial<HostConfig>;
      break;
    }
  }
  const cfg: HostConfig = { ...DEFAULTS, ...fileCfg, backups: { ...DEFAULTS.backups, ...(fileCfg.backups ?? {}) } };
  if (env.KNOCKON_PORT) cfg.port = Number(env.KNOCKON_PORT);
  if (env.KNOCKON_DATA) cfg.dataDir = env.KNOCKON_DATA;
  if (env.KNOCKON_STATIC) cfg.staticDir = env.KNOCKON_STATIC === 'none' ? null : env.KNOCKON_STATIC;
  cfg.dataDir = resolve(cwd, cfg.dataDir);
  if (cfg.staticDir) cfg.staticDir = resolve(cwd, cfg.staticDir);
  return cfg;
}

function stripJsonComments(s: string): string {
  return s.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1').replace(/\s+\/\/[^"\n]*$/gm, '');
}
