/**
 * Genera `src/domain/catalog.ts` a partir de `legacy/js/data.js` (la v1).
 *
 * ¿Por qué un generador y no copiar a mano? Porque el catálogo son ~300 líneas
 * de datos (136 ejercicios, 50 piezas de material, plantillas…) y copiarlas a
 * mano invita a colar erratas justo en el sitio donde no se notan. Así la
 * migración es reproducible: si el catálogo de la v1 cambia, se vuelve a lanzar
 *
 *     node tools/port-catalog.mjs && npx prettier --write src/domain/catalog.ts
 *
 * y las comprobaciones de integridad de `src/domain/data.test.ts` avisan si algo
 * queda incoherente (grupos o material que no existen, ids repetidos…).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'legacy/js/data.js';
const OUT = 'src/domain/catalog.ts';

const text = readFileSync(SRC, 'utf8');

/** Devuelve el literal (array u objeto) que sigue a `D.<name> =`, con sus corchetes. */
function literalAfter(name) {
  const re = new RegExp(`D\\.${name}\\s*=\\s*`);
  const m = re.exec(text);
  if (!m) throw new Error(`no encuentro D.${name} en ${SRC}`);
  const start = m.index + m[0].length;
  const open = text[start];
  if (open !== '[' && open !== '{') throw new Error(`D.${name} no empieza por un literal`);
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = null;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) break;
  }
  return text.slice(start, i + 1);
}

/** La v1 inserta 'paralelas' con splice en vez de dejarlo en la lista: se conserva tal cual. */
function equipmentSplice() {
  const m = /D\.EQUIPMENT\.splice\((\d+),\s*0,\s*([\s\S]*?)\);\n/.exec(text);
  if (!m) return [];
  return [
    '/* la v1 inserta esta pieza con splice (no está en la lista de arriba); se conserva',
    '   tal cual para que el orden del catálogo siga siendo el mismo */',
    `equipment.splice(${m[1]}, 0, ${m[2].trim()});`,
  ];
}

const SECTIONS = [
  ['GROUPS', 'readonly MuscleGroup[]', 'grupos musculares'],
  ['OPTIONAL', 'Record<string, readonly string[]>', 'sinergias: qué grupos acompaña cada uno'],
  ['EQUIPMENT', 'EquipmentItem[]', 'material disponible'],
  ['TEMPLATES', 'readonly RoutineTemplate[]', 'plantillas de rutina (receta por grupo)'],
  ['DAY_TYPES', 'readonly DayType[]', 'tipos de día del calendario'],
  ['DEFAULT_EQUIPMENT', 'Record<string, boolean>', 'material que viene activo de fábrica'],
  ['EQUIP_PRESETS', 'Record<string, readonly string[]>', 'presets de equipamiento'],
  ['LEVELS', 'readonly Level[]', 'niveles'],
  ['GOALS', 'readonly OptionItem[]', 'objetivos'],
  ['GOAL_REPS', 'Record<string, readonly [number, number]>', 'rango de reps por objetivo'],
  ['GOAL_SETS', 'Record<string, number>', 'series por objetivo'],
  ['GOAL_REST', 'Record<string, number>', 'descanso por objetivo'],
  ['ACCENTS', 'readonly string[]', 'acentos de la UI'],
  ['THEMES', 'readonly OptionItem[]', 'temas'],
  ['AI_MODELS', 'readonly ModelOption[]', 'modelos del coach'],
  ['THINKING_LEVELS', 'readonly OptionItem[]', 'niveles de razonamiento del coach'],
];

const lines = [];
lines.push(
  '/* ==========================================================================',
  '   Pulso v2 · catalog.ts — catálogo base (grupos, material, ejercicios, plantillas)',
  '',
  '   ARCHIVO GENERADO: no lo edites a mano. Se produce desde la v1 con',
  '',
  '       node tools/port-catalog.mjs && npx prettier --write src/domain/catalog.ts',
  '',
  '   a partir de `legacy/js/data.js`. Las comprobaciones de integridad están en',
  '   `src/domain/data.test.ts`.',
  '   ========================================================================== */',
  "import { slug } from './text';",
  'import type {',
  '  DayType,',
  '  EquipmentItem,',
  '  Exercise,',
  '  ExerciseOpts,',
  '  ExerciseType,',
  '  Level,',
  '  ModelOption,',
  '  MuscleGroup,',
  '  OptionItem,',
  '  RoutineTemplate,',
  "} from './types';",
  '',
  '/** Igual que `D.E()` de la v1: crea un ejercicio de biblioteca (custom: false). */',
  'function E(',
  '  name: string,',
  '  group: string,',
  '  equip: string,',
  '  type: ExerciseType,',
  '  sets: number,',
  '  repMin: number,',
  '  repMax: number,',
  '  rest: number,',
  '  opts: ExerciseOpts = {},',
  '): Exercise {',
  '  return {',
  '    id: slug(name),',
  '    name,',
  '    group,',
  "    equip: equip || '',",
  '    type,',
  '    sets,',
  '    repMin,',
  '    repMax,',
  '    rest,',
  "    allowed: opts.allowed !== false,",
  '    custom: false,',
  '    bw: !!opts.bw,',
  '    tags: opts.tags ?? [],',
  "    tips: opts.tips ?? '',",
  '  };',
  '}',
  '',
);

for (const [name, type, comment] of SECTIONS) {
  const literal = literalAfter(name);
  lines.push(`/* ---------- ${comment} ---------- */`);
  if (name === 'EQUIPMENT') {
    lines.push(`const equipment: ${type} = ${literal};`, ...equipmentSplice(), '');
    lines.push('export const EQUIPMENT: readonly EquipmentItem[] = equipment;', '');
  } else {
    lines.push(`export const ${name}: ${type} = ${literal};`, '');
  }
}

/* los ejercicios van aparte porque llevan llamadas a E(...) */
lines.push('/* ---------- base de datos de ejercicios ---------- */');
lines.push('/** `equip`: \'\' = peso corporal · \'a&b|c\' = requiere a Y (b o c) */');
lines.push(`export const SEED_EXERCISES: Exercise[] = ${literalAfter('SEED_EXERCISES')};`, '');

writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
console.log(`✓ ${OUT} generado desde ${SRC}`);
