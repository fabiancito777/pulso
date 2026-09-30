/**
 * System prompt y peticiones: la semántica de la v1 (JSON en suggest/plan,
 * markdown corto en analyze, 12 mensajes en chat) y la inyección del contexto.
 */
import { describe, expect, it } from 'vitest';

import {
  CHAT_HISTORY_LIMIT,
  CONSULT_INSTRUCTION,
  DEFAULT_SYSTEM,
  MEMORY_INSTRUCTION,
  buildRequest,
} from './prompts';
import type { ChatMessage } from './types';

describe('DEFAULT_SYSTEM', () => {
  it('recoge las reglas de la v1', () => {
    expect(DEFAULT_SYSTEM).toContain('español');
    expect(DEFAULT_SYSTEM).toContain('nombre exacto');
    expect(DEFAULT_SYSTEM).toContain('equipamiento e inventario');
    expect(DEFAULT_SYSTEM).toContain('sobrecarga progresiva');
    expect(DEFAULT_SYSTEM).toContain('180-240 s');
    expect(DEFAULT_SYSTEM).toContain('90-120 s');
    expect(DEFAULT_SYSTEM).toContain('60-75 s');
    expect(DEFAULT_SYSTEM).toContain('justifica brevemente');
    expect(DEFAULT_SYSTEM).toContain('ÚNICAMENTE el JSON');
    expect(DEFAULT_SYSTEM).toContain('no eres un médico');
  });
});

describe('MEMORY_INSTRUCTION', () => {
  it('pide el bloque ```memoria al final', () => {
    expect(MEMORY_INSTRUCTION).toContain('```memoria');
    expect(MEMORY_INSTRUCTION).toContain('MEMORIA DEL COACH');
    expect(MEMORY_INSTRUCTION).toContain('no pongas el bloque');
  });
});

describe('CONSULT_INSTRUCTION', () => {
  it('explica el bloque ```consulta con sus campos', () => {
    expect(CONSULT_INSTRUCTION).toContain('```consulta');
    expect(CONSULT_INSTRUCTION).toContain('"ejercicio":"Press banca"');
    expect(CONSULT_INSTRUCTION).toContain('full');
    expect(CONSULT_INSTRUCTION).toContain('reciente');
    expect(CONSULT_INSTRUCTION).toContain('evolucion');
    expect(CONSULT_INSTRUCTION).toContain('YYYY-MM-DD');
    expect(CONSULT_INSTRUCTION).toContain('30');
  });

  it('prohíbe inventar datos y recuerda el HISTORIAL CONSOLIDADO', () => {
    expect(CONSULT_INSTRUCTION).toContain('NUNCA inventes');
    expect(CONSULT_INSTRUCTION).toContain('HISTORIAL CONSOLIDADO');
    expect(CONSULT_INSTRUCTION).toContain('UN bloque');
  });
});

describe('buildRequest', () => {
  const context = '=== PERFIL ===\nNombre: Ana';

  it('inyecta el contexto detrás de CONTEXTO DEL USUARIO', () => {
    const req = buildRequest('chat', { context, question: 'hola' });
    expect(req.system).toContain(DEFAULT_SYSTEM);
    expect(req.system).toContain(MEMORY_INSTRUCTION);
    expect(req.system.endsWith(`\n\nCONTEXTO DEL USUARIO:\n${context}`)).toBe(true);
  });

  it('sin contexto no se añade la cabecera', () => {
    const req = buildRequest('chat', { question: 'hola' });
    expect(req.system).not.toContain('CONTEXTO DEL USUARIO');
  });

  it('permite system propio y desactivar la memoria', () => {
    const req = buildRequest('chat', { system: 'System custom', memory: false, question: 'x' });
    expect(req.system.startsWith('System custom')).toBe(true);
    expect(req.system).not.toContain('```memoria');
  });

  it('inyecta CONSULT_INSTRUCTION en chat y analyze, no en suggest/plan', () => {
    expect(buildRequest('chat', { question: 'hola' }).system).toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('analyze', { question: 'hola' }).system).toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('suggest').system).not.toContain(CONSULT_INSTRUCTION);
    expect(buildRequest('plan').system).not.toContain(CONSULT_INSTRUCTION);

    const sinConsulta = buildRequest('chat', { question: 'hola', consult: false }).system;
    expect(sinConsulta).not.toContain(CONSULT_INSTRUCTION);
    expect(sinConsulta).toContain(MEMORY_INSTRUCTION);
  });

  it('suggest pide JSON con el esquema de la v1', () => {
    const req = buildRequest('suggest', {
      context,
      unit: 'lb',
      local: { title: 'Empuje', exercises: [{ name: 'Press de banca' }] },
    });
    expect(req.json).toBe(true);
    expect(req.prompt).toContain('"exercises"');
    expect(req.prompt).toContain('weight en lb');
    expect(req.prompt).toContain('1 bloque de core');
    expect(req.prompt).toContain('Propuesta generada en el dispositivo');
    expect(req.prompt).toContain('Press de banca');
  });

  it('plan pide JSON con fechas y reglas de 48 h', () => {
    const req = buildRequest('plan', {
      from: '2026-09-21',
      to: '2026-09-27',
      goal: 'fuerza',
      daysPerWeek: 3,
      local: { days: [] },
    });
    expect(req.json).toBe(true);
    expect(req.prompt).toContain('del 2026-09-21 al 2026-09-27');
    expect(req.prompt).toContain('Fuerza');
    expect(req.prompt).toContain('días de entreno deseados: 3');
    expect(req.prompt).toContain('48 h');
    expect(req.prompt).toContain('Base generada en el dispositivo');
  });

  it('analyze pide markdown corto y no JSON', () => {
    const req = buildRequest('analyze', {
      weeks: 6,
      weeklyBrief: '21 sep: 4,2k kg, 3 ses, 36 series',
      question: '¿qué tal la semana?',
    });
    expect(req.json).toBe(false);
    expect(req.prompt).toContain('últimas 6 semanas');
    expect(req.prompt).toContain('400 palabras');
    expect(req.prompt).toContain('21 sep: 4,2k kg');
    expect(req.prompt).toContain('¿qué tal la semana?');
  });

  it('chat manda el mensaje y los últimos 12 del historial', () => {
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'model' : 'user',
      text: `mensaje ${i}`,
    }));
    /* mensajes de otros roles (p. ej. system) no viajan: se filtran como en la v1 */
    (history as { role: string; text: string }[]).push({ role: 'system', text: 'esto no cuenta' });

    const req = buildRequest('chat', { question: '¿cómo voy?', history });
    expect(req.json).toBe(false);
    expect(req.prompt).toBe('¿cómo voy?');
    const messages = req.history ?? [];
    expect(messages).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(messages[messages.length - 1].text).toBe('mensaje 19');
    expect(messages.some((message) => message.text === 'esto no cuenta')).toBe(false);
  });

  it('chat sin historial devuelve el campo vacío', () => {
    expect(buildRequest('chat', { question: 'hola' }).history).toEqual([]);
  });
});
