/**
 * Cifrado del blob y código de pareja: lo que garantiza que el servidor no vea
 * los datos. Se prueba con las pocas iteraciones de PBKDF2 que permite Node sin
 * tardar medio segundo por caso.
 */
import { describe, expect, it } from 'vitest';

import {
  codeBody,
  deriveSyncKey,
  generateSyncCode,
  normalizeSyncCode,
  openJson,
  resetKeyCache,
  sealJson,
  syncBlobId,
} from './sync-crypto';

const ITER = 1000;

describe('código de pareja', () => {
  it('sale con el formato PULSO-XXXX-XXXX-XXXX-XXXX', () => {
    const code = generateSyncCode();
    expect(code).toMatch(/^PULSO-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('cada código es distinto', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateSyncCode()));
    expect(codes.size).toBe(50);
  });

  it('se puede teclear sin guiones, en minúsculas y con el prefijo de más', () => {
    const code = generateSyncCode();
    const body = codeBody(code);
    expect(normalizeSyncCode(code)).toBe(code);
    expect(normalizeSyncCode(` ${body.toLowerCase()} `)).toBe(code);
    expect(normalizeSyncCode(`pulso${body}`)).toBe(code);
  });

  it('corrige las confusiones al dictarlo (O→0, I/L→1) y rechaza longitudes raras', () => {
    const code = 'PULSO-0000-1111-2222-3333';
    expect(normalizeSyncCode('pulso oooo iiii 2222 3333')).toBe(code);
    expect(normalizeSyncCode('PULSO-0000')).toBeNull();
    expect(normalizeSyncCode('')).toBeNull();
  });

  it('el id del blob es el hash del código y no lo contiene', async () => {
    const code = generateSyncCode();
    const id = await syncBlobId(code);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain(codeBody(code).toLowerCase());
    expect(await syncBlobId(code)).toBe(id);
  });
});

describe('sobre cifrado', () => {
  it('cifra y descifra un estado', async () => {
    resetKeyCache();
    const key = await deriveSyncKey(generateSyncCode(), ITER);
    const value = { sessions: [{ id: 'a', notes: 'áéíóú ✓' }] };
    const sealed = await sealJson(key, value);
    expect(JSON.stringify(sealed)).not.toContain('sesiones');
    await expect(openJson(key, sealed)).resolves.toEqual(value);
  });

  it('dos cifrados del mismo valor dan textos distintos (iv aleatorio)', async () => {
    resetKeyCache();
    const key = await deriveSyncKey(generateSyncCode(), ITER);
    const a = await sealJson(key, { a: 1 });
    const b = await sealJson(key, { a: 1 });
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });

  it('con otro código no se puede abrir', async () => {
    resetKeyCache();
    const key = await deriveSyncKey(generateSyncCode(), ITER);
    const other = await deriveSyncKey(generateSyncCode(), ITER);
    const sealed = await sealJson(key, { secreto: true });
    await expect(openJson(other, sealed)).rejects.toThrow();
  });
});
