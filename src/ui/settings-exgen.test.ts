/**
 * Generador IA de ejercicios en la UI (spec `_specs/generador-ejercicios.md`
 * §2/§4): el botón de Ajustes, el modal y sus reglas de cuota y de escritura.
 *
 * Vitest corre en node sin DOM (`vite.config.ts`), así que aquí no se monta
 * ningún componente: se leen los FICHEROS como texto (`?raw`, igual que
 * `settings-help.test.ts`) y se comprueba que la estructura del código no rompe
 * las reglas que sí importan — que la petición vive en un handler y no en el
 * render, que nada se escribe hasta que el usuario confirma, que sin API key no
 * se llama a nadie y que el HTML es seguro (Preact escapa solo).
 *
 * Los comentarios se QUitan antes de comparar: los propios docblocks mencionan
 * palabras como `innerHTML` o `useEffect` para decir que NO se usan.
 */
import { describe, expect, it } from 'vitest';

/** Todo el TSX de `src/ui` como texto, sin ejecutar un componente. */
const SOURCES = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Código sin comentarios (los docblocks nombran lo que prohíben). */
function code(file: string): string {
  const src = SOURCES[file] ?? '';
  return src.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const MODAL = code('./ExerciseGenModal.tsx');
const SETTINGS = code('./SettingsView.tsx');

/** Todas las líneas `import …` de un fichero, en orden. */
function imports(src: string): string[] {
  return [...src.matchAll(/^import[\s\S]*?;$/gmu)].map((m) => m[0]);
}

/** Especificadores (`'preact/hooks'`, `'./Modal'`…) de los imports de un fichero. */
function specifiers(src: string): string[] {
  return [...src.matchAll(/\bfrom '([^']+)'/gu)].map((m) => m[1] ?? '');
}

/** Índices de todas las apariciones de una cadena. */
function positions(src: string, needle: string): number[] {
  const out: number[] = [];
  let at = src.indexOf(needle);
  while (at >= 0) {
    out.push(at);
    at = src.indexOf(needle, at + needle.length);
  }
  return out;
}

describe('modal · seguridad y dependencias', () => {
  it('el HTML lo pinta Preact (escapado solo): nada de innerHTML', () => {
    expect(MODAL).not.toContain('dangerouslySetInnerHTML');
    expect(MODAL).not.toContain('innerHTML');
    expect(MODAL).not.toContain('insertAdjacentHTML');
    expect(MODAL).not.toContain('document.');
    expect(MODAL).not.toContain('<style');
  });

  it('solo hooks de Preact y módulos del propio proyecto (sin librerías nuevas)', () => {
    const specs = specifiers(MODAL);
    expect(specs.length).toBeGreaterThan(4);
    for (const spec of specs) {
      const propio = spec === 'preact/hooks' || spec.startsWith('@/') || spec.startsWith('.');
      expect(propio, `import no permitido: ${spec}`).toBe(true);
    }
    expect(specs).not.toContain('react');
  });

  it('el CSS es el último import (si no, los estilos pisan a los que se importan después)', () => {
    const all = imports(MODAL);
    expect(all.at(-1)).toContain('styles/exgen.css');
    expect(all.at(-1)).not.toContain('import type');
  });

  it('sus clases propias llevan prefijo exgen-* (no pisa las de base.css)', () => {
    const clases = [...MODAL.matchAll(/class=(?:"([^"]*)"|\{`([^`]+)`\})/gmu)].flatMap((m) =>
      (m[1] ?? m[2] ?? '')
        .replace(/\$\{[^}]*\}/gu, ' ')
        .split(/\s+/u)
        .filter(Boolean),
    );
    const propias = clases.filter((c) => c.startsWith('exgen-'));
    expect(propias).toEqual(
      expect.arrayContaining([
        'exgen-list',
        'exgen-item',
        'exgen-name',
        'exgen-desc',
        'exgen-warn',
        'exgen-actions',
        'exgen-error',
      ]),
    );
  });
});

describe('modal · la petición vive en un handler, no en el render', () => {
  it('generateExercises aparece UNA vez y dentro de `run`', () => {
    const calls = positions(MODAL, 'generateExercises(');
    expect(calls).toHaveLength(1);

    const run = MODAL.indexOf('const run = async');
    const despues = MODAL.indexOf('const patch');
    expect(run).toBeGreaterThan(0);
    expect(despues).toBeGreaterThan(run);
    expect(calls[0]).toBeGreaterThan(run);
    expect(calls[0]).toBeLessThan(despues);
  });

  it('no hay efectos de montaje: abrir el modal no pide nada', () => {
    expect(MODAL).not.toContain('useEffect');
    expect(MODAL).not.toContain('onMount');
    expect(positions(MODAL, 'generateExercises(').length).toBe(1);
  });

  it('el botón «Generar» es el único que dispara (y está deshabilitado sin texto)', () => {
    expect(MODAL).toContain('onClick={() => void run()}');
    expect(MODAL).toContain('disabled={busy || !hasKey || !text.trim()}');
    expect(MODAL).toContain('Generando…');
  });

  it('el consejo (advice) se pinta, pero no dispara nada por sí solo', () => {
    const bloque = MODAL.slice(MODAL.indexOf('{advice ?'), MODAL.indexOf('{issues.length ?'));
    expect(bloque).toContain('Te lo digo antes de inventar');
    expect(bloque).not.toContain('generateExercises');
    /* y el empty-state distingue «no hay propuestas» de «aún no has pedido» */
    expect(MODAL).toContain('Sin propuestas nuevas');
  });
});

describe('modal · nada se escribe hasta que el usuario confirma', () => {
  it('createExerciseFromAI no aparece en el render: solo en los handlers', () => {
    const primerRender = MODAL.indexOf('return (');
    const segundoRender = MODAL.indexOf('return (', primerRender + 1);
    expect(primerRender).toBeGreaterThan(0);
    expect(segundoRender).toBeGreaterThan(primerRender);
    /* antes del primer render están los handlers (onGaps, run, createOne,
       createSelected); entre el primer y el segundo solo está la rama sin key y
       después solo JSX */
    expect(MODAL.slice(0, primerRender)).toContain('createExerciseFromAI(');
    expect(MODAL.slice(segundoRender)).not.toContain('createExerciseFromAI(');
    expect(MODAL.slice(segundoRender)).toContain('onClick={() => createOne(');
    expect(MODAL.slice(segundoRender)).toContain('onClick={createSelected}');
  });

  it('la escritura pasa por el módulo único (aquí no se llama a saveExercise)', () => {
    expect(MODAL).toContain('createExerciseFromAI(');
    expect(MODAL).not.toContain('saveExercise(');
    expect(MODAL).not.toContain('writeState(');
  });

  it('«Crear y editar» abre el editor de Fase 0 y cierra el modal', () => {
    expect(MODAL).toContain('requestEdit(result.exercise.id)');
    expect(MODAL).toContain('onClose()');
    expect(MODAL).toContain('Crear y editar');
  });

  it('los duplicados arrancan des-seleccionados y se avisan en la tarjeta', () => {
    expect(MODAL).toContain('selected: !proposal.duplicateOf');
    expect(MODAL).toContain('Aviso: muy parecido a');
    expect(MODAL).toContain('item.error');
    expect(MODAL).toContain('p.notes.map');
  });

  it('el pie confirma el lote y la lista se puede descartar una a una', () => {
    expect(MODAL).toContain('pending ? `Crear ${pending} seleccionados` : ');
    expect(MODAL).toContain('disabled={busy || !pending}');
    expect(MODAL).toContain('Descartar');
    expect(MODAL).toContain('setItems((prev) => prev.filter((_, i) => i !== index))');
  });
});

describe('modal · sin API key → cero llamadas y atajo a Coach AI', () => {
  it('la rama sin key es una vuelta temprana con el aviso y el atajo', () => {
    const hasKey = MODAL.indexOf('const hasKey = hasApiKey();');
    const rama = MODAL.indexOf('if (!hasKey) {');
    const primerRender = MODAL.indexOf('return (');
    const segundoRender = MODAL.indexOf('return (', primerRender + 1);
    expect(hasKey).toBeGreaterThan(0);
    expect(rama).toBeGreaterThan(hasKey);
    expect(rama).toBeLessThan(primerRender);
    expect(segundoRender).toBeGreaterThan(primerRender);

    /* la rama sin key ocupa el PRIMER render, antes de la lista de propuestas */
    const sinKey = MODAL.slice(primerRender, segundoRender);
    expect(sinKey).toContain('Necesita API key');
    expect(sinKey).toContain("go('ajustes', 'coach')");
    expect(sinKey).toContain('title="Generar ejercicios con IA"');
  });

  it('sin key el botón de generar está deshabilitado (ni siquiera se llega a `run`)', () => {
    expect(MODAL).toContain('disabled={busy || !hasKey || !text.trim()}');
    expect(MODAL).toContain('if (busy || !hasKey || !prompt) return;');
  });
});

describe('Ajustes · botón, aviso y montaje del modal', () => {
  it('«Generar con IA» abre el modal (sin tocar la red aquí)', () => {
    expect(SETTINGS).toContain('Generar con IA');
    expect(SETTINGS).toContain("onClick={() => setGen('')}");
    expect(SETTINGS).toContain('{gen === null ? null : <ExerciseGenModal');
    expect(SETTINGS).toContain('initialPrompt={gen}');
    expect(SETTINGS).not.toContain('generateExercises');
  });

  it('los grupos sin ejercicios se pueden generar desde la biblioteca', () => {
    expect(SETTINGS).toContain('Sin ejercicios todavía');
    expect(SETTINGS).toContain('setGen(`Ejercicios nuevos para ${g.label}`)');
  });

  it('sin API key se enseña el acceso directo a Ajustes → Coach AI', () => {
    expect(SETTINGS).toContain('Falta API key');
    expect(SETTINGS).toMatch(/hasApiKey\(\) \? null :/u);
    expect(SETTINGS).toContain("go('ajustes', 'coach')");
  });

  it('el modal se importa como cualquier otra pieza de la vista', () => {
    expect(SETTINGS).toContain("from '@/ui/ExerciseGenModal'");
    const specs = specifiers(SETTINGS);
    expect(specs.filter((s) => s === '@/ui/ExerciseGenModal')).toHaveLength(1);
  });
});
