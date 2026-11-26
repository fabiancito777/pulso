import { useState } from 'preact/hooks';

import { EXERCISE_GUIDES } from '@/domain/exercise-guides';
import type { ExerciseGuide, ExerciseGuidePhase } from '@/domain/exercise-guides';

import { Icon } from './Icon';
import { Modal } from './Modal';

function guideImageSrc(src: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${src.replace(/^\.\//, '').replace(/^\/+/, '')}`;
}

function ExerciseDemoThumb({ phase }: { phase: ExerciseGuidePhase }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      class={`exercise-demo-thumb${phase.crop ? ` crop-${phase.crop}` : ''}`}
      aria-hidden="true"
    >
      {failed ? (
        <Icon name="eye" />
      ) : (
        <img
          src={guideImageSrc(phase.src)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function ExerciseDemoModal({
  guide,
  name,
  cue,
  onClose,
}: {
  guide: ExerciseGuide;
  name: string;
  cue: string;
  onClose: () => void;
}) {
  const phases = guide.phases;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const phase = phases[phaseIndex] ?? phases[0];
  if (!phase) return null;
  const failed = failedSources.includes(phase.src);
  return (
    <Modal title={name} sub="Guía visual" onClose={onClose}>
      <div class="simple-demo-body">
        {failed ? (
          <div class="simple-demo-fallback" role="status">
            <Icon name="info" />
            <span>Esta fase no está disponible. Puedes seguir con el ejercicio.</span>
          </div>
        ) : (
          <div class={`simple-demo-stage${phase.crop ? ` crop-${phase.crop}` : ''}`}>
            <img
              key={phase.src}
              class="simple-demo-image"
              src={guideImageSrc(phase.src)}
              alt={`${name}: ${phase.label}`}
              onError={() =>
                setFailedSources((previous) =>
                  previous.includes(phase.src) ? previous : [...previous, phase.src],
                )
              }
            />
          </div>
        )}
        {phases.length > 1 ? (
          <div class="simple-demo-phases" role="group" aria-label="Fases del movimiento">
            {phases.map((item, index) => (
              <button
                key={`${item.src}:${item.crop ?? ''}:${index}`}
                type="button"
                class={index === phaseIndex ? 'on' : ''}
                aria-pressed={index === phaseIndex}
                onClick={() => setPhaseIndex(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div class="simple-demo-single-label">{phase.label}</div>
        )}
        {cue ? <p class="simple-demo-cue">{cue}</p> : null}
      </div>
    </Modal>
  );
}

/** Guía visual reutilizada desde una sesión y el editor de rutinas. */
export function ExerciseGuidePreview({
  exerciseId,
  name,
  cue = '',
  className = 'btn sm quiet exercise-demo-trigger',
}: {
  exerciseId: string;
  name: string;
  cue?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const guide = Object.prototype.hasOwnProperty.call(EXERCISE_GUIDES, exerciseId)
    ? EXERCISE_GUIDES[exerciseId]
    : undefined;
  const phase = guide?.phases[0];
  if (!guide || !phase) return null;

  return (
    <>
      <button
        type="button"
        class={className}
        aria-label={`Ver movimiento de ${name}`}
        aria-haspopup="dialog"
        title="Ver movimiento"
        onClick={() => setOpen(true)}
      >
        <ExerciseDemoThumb key={phase.src} phase={phase} />
      </button>
      {open ? (
        <ExerciseDemoModal guide={guide} name={name} cue={cue} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
