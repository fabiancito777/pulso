/**
 * Conexión de la ayuda a la UI (spec `help-ux.md` §3.3 y fases 2-3).
 *
 * El proyecto no tiene DOM (Vitest corre en node, `vite.config.ts:29-32`), así
 * que aquí no se renderiza nada: se leen los FICHEROS como texto (`?raw`, el
 * único modo que `tsc` tipa con `vite/client`) y se comprueba que cada
 * `help="…"` (filas de `kit`) y cada `<HelpBtn id="…">` (cabeceras) apunta a un
 * id que existe, que Ajustes engancha todas sus entradas `opt.*` y que las 7
 * pestañas tienen su ? en su vista. Un id borrado de `help-content.ts` ya lo
 * caza `tsc` (es un union literal); lo que este test vigila es lo contrario:
 * que nadie se QUede sin enganchar.
 */
import { describe, expect, it } from 'vitest';

import { HELP_IDS } from './help-content';

/** Todo el TSX de `src/ui` como texto, sin ejecutar un solo componente. */
const SOURCES = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** El shell (`src/app`): ahí está el chip `?` de la barra, con `openHelp('guide')`. */
const SHELL = import.meta.glob('../app/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Los ids de ayuda que un fichero engancha (`help="…"` o `<HelpBtn id="…">`). */
function idsIn(src: string): string[] {
  return [...src.matchAll(/(?:help=|HelpBtn id=)"([^"]+)"/gu)].map((m) => m[1] ?? '');
}

/** Los ids abiertos a pelo (`openHelp('guide')`): el chip y el pie del modal. */
function openedIn(src: string): string[] {
  return [...src.matchAll(/openHelp\('([^']+)'\)/gu)].map((m) => m[1] ?? '');
}

/** Todo lo que está anclado en la app, sea cual sea el mecanismo. */
const ANCHORED = new Set(
  [...Object.values(SOURCES), ...Object.values(SHELL)].flatMap((src) => [
    ...idsIn(src),
    ...openedIn(src),
  ]),
);

describe('cada ayuda apunta a un id que existe', () => {
  it('ningún help="…" / HelpBtn id="…" de src/ui es desconocido', () => {
    const known = new Set<string>(HELP_IDS);
    for (const [file, src] of Object.entries(SOURCES)) {
      for (const id of idsIn(src)) {
        expect(known.has(id), `${file} → ${id}`).toBe(true);
      }
    }
  });

  it('hay ayuda enganchada en al menos 10 ficheros (no se queda en uno solo)', () => {
    const files = Object.entries(SOURCES).filter(([, src]) => idsIn(src).length > 0);
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
});

describe('ningún tema se queda sin ancla', () => {
  /* El glosario no lleva botón propio: se llega por el buscador de la guía y
     por los chips «ver también» (los vigila `help-content.test.ts`). */
  it('todo id de la guía está enganchado en el shell o en una vista', () => {
    const missing = HELP_IDS.filter((id) => !id.startsWith('glossary.') && !ANCHORED.has(id));
    expect(missing).toEqual([]);
  });
});

describe('Ajustes · fase 2', () => {
  const src = SOURCES['./SettingsView.tsx'] ?? '';

  it('las 26 entradas opt.* de la guía están enganchadas', () => {
    const opts = HELP_IDS.filter((id) => id.startsWith('opt.'));
    expect(opts).toHaveLength(26);
    const used = new Set(idsIn(src));
    for (const id of opts) expect(used.has(id), id).toBe(true);
  });

  it('coach.apiKey también (la única de coach.* que vive en Ajustes)', () => {
    expect(idsIn(src)).toContain('coach.apiKey');
  });

  it('subsección Ayuda: noveno elemento de SUBS y renderizada', () => {
    expect(src).toMatch(/\{ key: 'ayuda', label: 'Ayuda', icon: 'info' \}/u);
    expect(src).toMatch(/key === 'ayuda' \? <SecAyuda \/>/u);
  });

  it('SecAyuda reutiliza el GuideIndex del modal (un solo índice)', () => {
    expect(src).toContain('<GuideIndex />');
  });
});

describe('fase 3 · una ayuda por pestaña', () => {
  /* dónde vive la cabecera de cada pestaña */
  const TAB_VIEWS: [id: string, files: string[]][] = [
    ['tab.hoy', ['./HoyView.tsx']],
    ['tab.entrenar', ['./SessionCard.tsx']],
    ['tab.rutinas', ['./RoutinesView.tsx']],
    ['tab.calendario', ['./CalendarView.tsx']],
    ['tab.coach', ['./CoachView.tsx']],
    ['tab.progreso', ['./ProgressCard.tsx']],
    ['tab.ajustes', ['./SettingsView.tsx']],
  ];

  it('los 7 tab.* existen y están conectados en su vista', () => {
    expect(HELP_IDS.filter((id) => id.startsWith('tab.'))).toHaveLength(7);
    for (const [id, files] of TAB_VIEWS) {
      expect(HELP_IDS, id).toContain(id);
      const where = files.filter((f) => idsIn(SOURCES[f] ?? '').includes(id));
      expect(where, `${id} no está en ${files.join(' ni ')}`).not.toHaveLength(0);
    }
  });

  it('la calculadora explica su inventario (opt.plates en su cabecera)', () => {
    expect(idsIn(SOURCES['./PlatesCard.tsx'] ?? '')).toContain('opt.plates');
  });

  it('el onboarding apunta a la guía (una línea, sin reestructurar el modal)', () => {
    const onboarding = SOURCES['./Onboarding.tsx'] ?? '';
    expect(onboarding).toMatch(/guía de la app/u);
    expect(onboarding).toMatch(/Ajustes →\s*Ayuda/u);
  });
});
