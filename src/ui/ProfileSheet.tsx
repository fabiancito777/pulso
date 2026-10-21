/**
 * Hoja de perfiles de la barra superior.
 *
 * Lista los perfiles, permite cambiar (guardando la sesión en curso, con aviso)
 * y crear uno nuevo. La gestión completa (renombrar/borrar) vive en Ajustes.
 */
import { useState } from 'preact/hooks';

import { timeAgo } from '@/domain/dates';
import { MAX_PROFILES, activeProfileId, profileInitial, profiles } from '@/state/profiles';
import { active, createProfile, switchProfile } from '@/state/store';

import { Icon } from './Icon';
import { Modal } from './Modal';

const SESSION_WARNING =
  'Tienes una sesión en curso. Se guardará en este perfil y podrás retomarla al volver.';

function Avatar({ name, color, big }: { name: string; color: string; big?: boolean }) {
  return (
    <span class={`pf-avatar${big ? ' lg' : ''}`} style={`background:${color}`} aria-hidden="true">
      {profileInitial(name)}
    </span>
  );
}

export function ProfileSheet({ onClose, onManage }: { onClose: () => void; onManage: () => void }) {
  const list = profiles.value;
  const current = activeProfileId.value;
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const choose = (id: string): void => {
    if (id === current) {
      onClose();
      return;
    }
    if (active.value && !window.confirm(SESSION_WARNING)) return;
    if (!switchProfile(id)) {
      setError('No se pudo cambiar de perfil.');
      return;
    }
    location.reload();
  };

  const create = (): void => {
    const clean = name.trim();
    if (!clean) {
      setError('Ponle un nombre al perfil.');
      return;
    }
    if (active.value && !window.confirm(SESSION_WARNING)) return;
    const profile = createProfile(clean);
    if (!profile) {
      setError(
        list.length >= MAX_PROFILES
          ? `Máximo ${MAX_PROFILES} perfiles en este dispositivo.`
          : 'No se pudo crear el perfil.',
      );
      return;
    }
    if (!switchProfile(profile.id)) {
      setError('No se pudo cambiar al perfil nuevo.');
      return;
    }
    location.reload();
  };

  return (
    <Modal
      title="Perfiles"
      onClose={onClose}
      foot={
        <button type="button" class="btn ghost" onClick={onManage}>
          <Icon name="gear" />
          Gestionar perfiles
        </button>
      }
    >
      <div class="tiny muted">Cambiar de perfil guarda la sesión en curso de este.</div>
      <div class="list card flush mt-s">
        {list.map((profile) => {
          const isActive = profile.id === current;
          return (
            <button
              key={profile.id}
              type="button"
              class={`list-item tappable pf-row${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => choose(profile.id)}
            >
              <Avatar name={profile.name} color={profile.color} />
              <span class="li-main">
                <span class="li-title">{profile.name}</span>
                <span class="li-sub">
                  {isActive ? 'Perfil activo' : `Última vez ${timeAgo(profile.lastUsedAt)}`}
                </span>
              </span>
              {isActive ? <span class="pf-check">✓</span> : <span class="li-sub">Cambiar</span>}
            </button>
          );
        })}
      </div>

      {list.length < MAX_PROFILES ? (
        <div class="pf-create mt-s">
          <input
            class="input"
            value={name}
            placeholder="Nombre del perfil nuevo"
            aria-label="Nombre del perfil nuevo"
            maxLength={40}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
          <button type="button" class="btn primary" onClick={create}>
            <Icon name="plus" />
            Crear
          </button>
        </div>
      ) : (
        <div class="tiny muted mt-s">Máximo {MAX_PROFILES} perfiles en este dispositivo.</div>
      )}

      {error ? (
        <div class="tiny warn mt-s" role="alert">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
