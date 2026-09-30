/**
 * `src/ui/CoachView.tsx`: paridad de la tarjeta de estado y de los chips
 * rápidos con `legacy/js/views-coach.js`.
 *
 * Los tests corren en node (sin DOM), así que aquí NO se monta el componente:
 * lo que hay que vigilar es el DATO, que es lo que se rompe sin darse cuenta —
 * los 6 chips de la v1 con sus prompts literales, iconos que existan de verdad
 * en el catálogo generado (`ui/icons.ts` es un archivo generado), el badge de
 * ms/ok del «Probar» y las opciones de un turno (`turnOpts`), que es lo único
 * que manda la pregunta del usuario al modelo.
 */
import { describe, expect, it } from 'vitest';

import { ICONS } from '@/ui/icons';
import { QUICK_ACTIONS, testBadge, turnOpts } from './CoachView';

describe('turno de la vista (`turnOpts` → runCoachTask)', () => {
  it('en chat la pregunta viaja en userText y el historial detrás', () => {
    const history = [
      { role: 'model' as const, text: 'hola' },
      { role: 'user' as const, text: '¿y hoy?' },
    ];
    expect(turnOpts('chat', '¿qué hice esta semana?', history)).toEqual({
      userText: '¿qué hice esta semana?',
      history,
    });
  });

  it('fuera del chat no se manda historial, pero la pregunta SÍ', () => {
    expect(turnOpts('analyze', 'revisa mi volumen', [])).toEqual({
      userText: 'revisa mi volumen',
    });
    expect(turnOpts('suggest', 'sugiere entreno', [])).toEqual({ userText: 'sugiere entreno' });
    expect(turnOpts('plan', 'planifica la semana', [])).toEqual({
      userText: 'planifica la semana',
    });
  });

  it('ningún turno se queda sin userText (con historial la API devuelve HTTP 400)', () => {
    for (const task of ['chat', 'analyze', 'suggest', 'plan'] as const) {
      expect(turnOpts(task, 'pregunta', []).userText, task).toBe('pregunta');
    }
  });
});

describe('chips rápidos (v1 `coach:quick`)', () => {
  it('son 6 y las etiquetas no se repiten (son la key de React)', () => {
    expect(QUICK_ACTIONS).toHaveLength(6);
    expect(new Set(QUICK_ACTIONS.map((a) => a.label)).size).toBe(6);
  });

  it('los tres que faltaban llevan el prompt LITERAL de la v1', () => {
    expect(QUICK_ACTIONS.slice(3).map((a) => [a.label, a.ask])).toEqual([
      [
        'Revisar volumen',
        'Revisa mi volumen semanal por grupo muscular y dime qué grupos están descompensados y cómo corregirlo.',
      ],
      [
        'Romper un récord',
        'Elige el ejercicio donde tengo más margen de mejora y dame un plan concreto de 4 semanas para subir mi récord.',
      ],
      [
        'Consejo de recuperación',
        '¿Qué ajustes de recuperación, sueño y alimentación me recomiendas según mi volumen actual de entrenamiento?',
      ],
    ]);
  });

  it('los tres nuevos van a un `chat` (la v1 los mandaba con send())', () => {
    expect(QUICK_ACTIONS.map((a) => a.task)).toEqual([
      'suggest',
      'plan',
      'analyze',
      'chat',
      'chat',
      'chat',
    ]);
  });

  it('todos los iconos existen en el catálogo generado', () => {
    for (const action of QUICK_ACTIONS) {
      expect(ICONS[action.icon], `icono de «${action.label}»`).toBeDefined();
    }
  });

  it('solo el chip de sesión de hoy salta de pestaña (v1: App.router.go)', () => {
    const jumps = QUICK_ACTIONS.filter((a) => a.jump);
    expect(jumps.map((a) => a.label)).toEqual(['Sugerir entreno']);
    expect(jumps[0]?.jump).toEqual({ tab: 'hoy', toast: 'Sesión lista en la pestaña Hoy' });
  });
});

describe('tarjeta de estado (v1 `coach:test`)', () => {
  it('badge: `listo` antes del primer test, y ok/error con los ms después', () => {
    expect(testBadge(null)).toBe('listo');
    expect(testBadge({ ok: true, ms: 812 })).toBe('ok · 0.8 s');
    expect(testBadge({ ok: false, ms: 2100 })).toBe('error · 2.1 s');
  });
});
