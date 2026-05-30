/**
 * 토큰 저장소 — .tokens.json 파일 기반 (gitignore됨).
 * 해커톤 수준: 단일 사용자, 단일 토큰 세트.
 * 토큰 없거나 7일 초과 만료 시 null 반환 → .ics fallback 경로.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = resolve(__dir, '..', '.tokens.json');

/** 7일 (밀리초) */
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  saved_at: number;
}

export function loadToken(): StoredToken | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(TOKEN_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredToken;
    const age = Date.now() - (parsed.saved_at ?? 0);
    if (age > TOKEN_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveToken(token: Omit<StoredToken, 'saved_at'>): void {
  const data: StoredToken = { ...token, saved_at: Date.now() };
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
