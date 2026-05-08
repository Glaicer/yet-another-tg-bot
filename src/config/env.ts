import dotenv from 'dotenv';

export function loadEnv(envPath?: string): void {
  dotenv.config(envPath ? { path: envPath } : undefined);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function resolveEnvVar(envName: string): string | undefined {
  return process.env[envName];
}

export function resolveEnvVarRequired(envName: string): string {
  const value = process.env[envName];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable referenced by config: ${envName}`);
  }
  return value;
}
