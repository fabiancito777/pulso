/**
 * `parseJSON`: el puerto tolerante de la v1. El modelo a veces enmarca la
 * respuesta, a veces la rodea de prosa y a veces deja una coma final: todas esas
 * manías están fijadas aquí.
 */
import { describe, expect, it } from 'vitest';

import { extractBlocks, parseJSON } from './parse';

describe('parseJSON', () => {
  it('devuelve el JSON limpio tal cual', () => {
    expect(parseJSON('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
    expect(parseJSON('  [1, 2, 3]  ')).toEqual([1, 2, 3]);
  });

  it('quita la cercilla ```json aunque lleve prosa alrededor', () => {
    const raw = 'Aquí tienes tu plan:\n```json\n{"title":"Empuje"}\n```\n¡A entrenar!';
    expect(parseJSON(raw)).toEqual({ title: 'Empuje' });
  });

  it('quita la cercilla sin lenguaje declarado', () => {
    expect(parseJSON('```\n[{"name":"Press"}]\n```')).toEqual([{ name: 'Press' }]);
  });

  it('recorta la coma final de un objeto', () => {
    expect(parseJSON('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
  });

  it('recorta la coma final de un array', () => {
    expect(parseJSON('[1,2,3,]')).toEqual([1, 2, 3]);
  });

  it('se come la prosa de delante y de detrás', () => {
    const raw = 'Claro, aquí va el plan:\n{"title":"Piernas","exercises":[]}\nEspero que te sirva.';
    expect(parseJSON(raw)).toEqual({ title: 'Piernas', exercises: [] });
  });

  it('sobrevive a prosa, cercilla y comas finales a la vez', () => {
    const raw = 'Voy con ello:\n```json\n{\n  "sets": 4,\n  "rest": 120,\n}\n```';
    expect(parseJSON(raw)).toEqual({ sets: 4, rest: 120 });
  });

  it('JSON válido seguido de prosa con } y cercilla: se queda con el de delante', () => {
    /* este es el fallo real del smoke test: el recorte clásico iba del primer {
       al ÚLTIMO }, que ya estaba dentro de la prosa de después */
    const raw =
      '{"title":"Tracción y Core","exercises":[{"name":"Dominadas"}]}\n' +
      'Espero que te sirva } y si quieres más ```json\n{"otro":1}\n```';
    expect(parseJSON(raw)).toEqual({
      title: 'Tracción y Core',
      exercises: [{ name: 'Dominadas' }],
    });
  });

  it('prosa con llaves por delante: prueba desde cada llave hasta dar con la que parsea', () => {
    const raw = 'Te lo dejo {en dos} partes:\n{"sets":4,"rest":120}\n';
    expect(parseJSON(raw)).toEqual({ sets: 4, rest: 120 });
  });

  it('JSON al principio y cercilla después: manda el del principio, no el de la prosa', () => {
    const raw = '{"title":"A"}\nLuego ```json\n{"title":"B"}\n```';
    expect(parseJSON(raw)).toEqual({ title: 'A' });
  });

  it('no confunde una } de dentro de una cadena con el cierre del objeto', () => {
    expect(parseJSON('{"notes":"cierra } aquí"} prosa }')).toEqual({ notes: 'cierra } aquí' });
  });

  it('JSON y después un bloque ```memoria``` (así FALLABA el smoke test)', () => {
    /* la v1 quitaba la PRIMERA cercilla fuera de sitio: se quedaba con las
       viñetas de la memoria (sin llaves) y reventaba con el JSON perfecto */
    const raw =
      '{\n  "title": "Tracción y Core",\n  "exercises": [{ "name": "Dominadas" }]\n}\n' +
      '```memoria\n- Prefiere mantener cargas estables si roza el fallo\n```';
    expect(parseJSON(raw)).toEqual({
      title: 'Tracción y Core',
      exercises: [{ name: 'Dominadas' }],
    });
  });

  it('JSON truncado sigue lanzando el error de la v1', () => {
    expect(() => parseJSON('{"a": {"b": 1}')).toThrow('no pude interpretar el JSON');
  });

  it('lanza el error de la v1 cuando no hay ningún JSON', () => {
    expect(() => parseJSON('no voy a darte JSON hoy')).toThrow('no pude interpretar el JSON');
    expect(() => parseJSON('')).toThrow('no pude interpretar el JSON');
    expect(() => parseJSON('{"a":')).toThrow('no pude interpretar el JSON');
  });
});

describe('extractBlocks', () => {
  it('extrae todos los bloques de la etiqueta y deja fuera el resto', () => {
    const text =
      'Antes\n```consulta\n{"ejercicio":"Press"}\n```\nEntre\n```consulta\n{"tipo":"full"}\n```\nDespués';
    const { rest, blocks } = extractBlocks(text, 'consulta');
    expect(blocks).toEqual(['{"ejercicio":"Press"}', '{"tipo":"full"}']);
    expect(rest.replace(/\s+/g, ' ').trim()).toBe('Antes Entre Después');
    expect(rest).not.toContain('```consulta');
  });

  it('admite la prosa que el modelo pega tras la etiqueta', () => {
    const { blocks, rest } = extractBlocks('```memoria otra vez\n- duerme 8 h\n```', 'memoria');
    expect(blocks).toEqual(['- duerme 8 h']);
    expect(rest).toBe('');
  });

  it('la etiqueta se escapa: un prefijo parecido no es un bloque', () => {
    const text = '```memoriax\nesto no es\n```';
    expect(extractBlocks(text, 'memoria')).toEqual({ rest: text, blocks: [] });
    expect(extractBlocks('```consulta\n{}\n```', 'memoria')).toEqual({
      rest: '```consulta\n{}\n```',
      blocks: [],
    });
  });

  it('sin etiqueta o sin bloques devuelve el texto intacto', () => {
    const text = 'hola\n```json\n{}\n```';
    expect(extractBlocks(text, '')).toEqual({ rest: text, blocks: [] });
    expect(extractBlocks(text, 'consulta')).toEqual({ rest: text, blocks: [] });
    expect(extractBlocks('', 'consulta')).toEqual({ rest: '', blocks: [] });
  });

  it('un bloque vacío se extrae como cadena vacía', () => {
    expect(extractBlocks('Listo.\n```consulta\n```', 'consulta')).toEqual({
      rest: 'Listo.\n',
      blocks: [''],
    });
  });
});
