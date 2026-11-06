/**
 * Ajustes → Datos → «Sincronizar móvil y PC».
 *
 * Sin login: un código de pareja vincula los dispositivos y a partir de ahí todo
 * va cifrado (ver `state/sync.ts`). La tarjeta solo enseña el estado y abre los
 * dos diálogos: el de vinculación y el de revisión de conflictos.
 *
 * El de conflictos es el que pide el usuario: cuando los dos dispositivos
 * cambiaron lo mismo, se enseña qué hay en cada uno y se elige. Nada se aplica
 * hasta que elige.
 */
import { useState } from 'preact/hooks';

import { timeAgo } from '@/domain/dates';
import type { SyncArea } from '@/domain/sync';

import { ListButton } from './kit';
import { Modal } from './Modal';
import { toast } from './toast';
import {
  announce,
  createSyncLink,
  DEFAULT_SYNC_URL,
  isLinked,
  joinSyncLink,
  localSessionCount,
  normalizeSyncUrl,
  syncConfig,
  syncNow,
  syncStatus,
  unlinkSync,
  type SyncOutcome,
  type SyncPreview,
} from '@/state/sync';

const AREA_LABEL: Record<SyncArea, string> = {
  settings: 'ajustes',
  equipment: 'material',
  exercises: 'biblioteca',
  routines: 'rutinas',
  schedule: 'calendario',
};

const STATUS_LABEL = {
  idle: 'al día',
  syncing: 'sincronizando…',
  error: 'con error',
  conflict: 'necesita revisión',
  off: 'sin vincular',
} as const;

function copyText(text: string): void {
  void (async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Código copiado', { kind: 'ok' });
    } catch {
      toast('No se pudo copiar: apúntalo a mano', { kind: 'warn' });
    }
  })();
}

/** Diálogo para crear o aceptar un código. */
function LinkModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(syncConfig.value?.url || DEFAULT_SYNC_URL);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (action: () => Promise<SyncOutcome>): Promise<void> => {
    setBusy(true);
    setMsg('');
    try {
      const out = await action();
      if (out.kind === 'conflict') {
        setMsg('Vinculado. Hay cambios en los dos sitios: vuelve a Datos para revisarlos.');
        return;
      }
      if (out.kind === 'error') {
        setMsg(out.message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const validUrl = normalizeSyncUrl(url) !== '';

  return (
    <Modal
      title="Sincronizar dispositivos"
      sub="Móvil y PC con los mismos datos, cifrados"
      onClose={onClose}
      dismissable={!busy}
      foot={
        <>
          <button class="btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            class="btn"
            type="button"
            disabled={busy || !validUrl}
            onClick={() => void run(() => createSyncLink(url))}
          >
            {busy ? 'Conectando…' : 'Crear código aquí'}
          </button>
        </>
      }
    >
      <div class="tiny muted">
        El código es la única llave: no hay cuentas ni contraseñas. Se puede dictar por teléfono y
        no se envía al servidor (solo viaja un hash).
      </div>
      <label class="field mt">
        <span class="label">Dirección del servidor</span>
        <input
          class="input"
          type="url"
          inputMode="url"
          placeholder="https://pulso-sync.tu-cuenta.workers.dev"
          value={url}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
      </label>
      {!validUrl ? (
        <div class="tiny warn mt-s">Pega la URL del Worker (o la de `tools/sync-dev.mjs`).</div>
      ) : null}

      <div class="h3 mt">¿Ya tienes un código en el otro dispositivo?</div>
      <label class="field mt-s">
        <span class="label">Código de pareja</span>
        <input
          class="input"
          type="text"
          autocapitalize="characters"
          spellcheck={false}
          placeholder="PULSO-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onInput={(event) => setCode(event.currentTarget.value)}
        />
      </label>
      <button
        class="btn ghost mt-s"
        type="button"
        disabled={busy || !validUrl || code.trim().length < 8}
        onClick={() => void run(() => joinSyncLink(url, code))}
      >
        Unirme a ese código
      </button>
      {msg ? <div class="tiny warn mt-s">{msg}</div> : null}
    </Modal>
  );
}

/** Diálogo de revisión: qué hay en cada lado y qué se queda. */
function ConflictModal({
  preview,
  onClose,
}: {
  preview: SyncPreview;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { report } = preview;

  const decide = async (prefer: 'newest' | 'local' | 'remote'): Promise<void> => {
    setBusy(true);
    const out = await syncNow(prefer);
    setBusy(false);
    if (out.kind === 'conflict') {
      toast('Sigue habiendo cambios nuevos: vuelve a intentarlo', { kind: 'warn' });
      return;
    }
    announce(out);
    onClose();
  };

  return (
    <Modal
      title="Hay cambios en los dos dispositivos"
      sub="Elige qué se queda; las sesiones no se pierden nunca"
      onClose={onClose}
      dismissable={!busy}
      foot={
        <button class="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Luego
        </button>
      }
    >
      <div class="kv">
        <span class="k">Sesiones aquí</span>
        <span class="v">{preview.localSessions}</span>
      </div>
      <div class="kv">
        <span class="k">Sesiones en el otro</span>
        <span class="v">
          {preview.remoteSessions}
          {report.sessions.added ? ` · ${report.sessions.added} nuevas` : ''}
        </span>
      </div>
      <div class="kv">
        <span class="k">Rutinas</span>
        <span class="v">
          {report.routines.local} aquí · {report.routines.remote} allí
        </span>
      </div>
      <div class="kv">
        <span class="k">Cambiado en los dos</span>
        <span class="v">{preview.areas.map((area) => AREA_LABEL[area]).join(', ')}</span>
      </div>

      {report.settingsPreview.length ? (
        <div class="card tight mt">
          <div class="tiny muted mb-s">Si gana el otro, cambian estos ajustes:</div>
          {report.settingsPreview.slice(0, 8).map((change) => (
            <div key={change.key} class="tiny">
              <b>{change.key}</b>: {change.from} → {change.to}
            </div>
          ))}
        </div>
      ) : null}

      <div class="tiny muted mt">
        «Combinar» se queda lo más reciente de cada bloque (sesiones y rutinas se suman siempre).
      </div>

      <button
        class="btn mt"
        type="button"
        disabled={busy}
        onClick={() => void decide('newest')}
      >
        Combinar lo más reciente
      </button>
      <button class="btn ghost mt-s" type="button" disabled={busy} onClick={() => void decide('local')}>
        Quedarme con este dispositivo
      </button>
      <button class="btn ghost mt-s" type="button" disabled={busy} onClick={() => void decide('remote')}>
        Quedarme con el otro
      </button>
    </Modal>
  );
}

export function SyncCard() {
  const [link, setLink] = useState(false);
  const [conflict, setConflict] = useState<SyncPreview | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const config = syncConfig.value;
  const status = syncStatus.value;
  const linked = isLinked();

  const handle = (out: SyncOutcome): void => {
    if (out.kind === 'conflict') {
      setConflict(out.preview);
      return;
    }
    announce(out);
  };

  const now = async (): Promise<void> => {
    setBusy(true);
    handle(await syncNow());
    setBusy(false);
  };

  return (
    <>
      <ListButton
        icon="refresh"
        title={linked ? 'Sincronizar ahora' : 'Sincronizar móvil y PC'}
        sub={
          linked && config
            ? `${STATUS_LABEL[status.kind]}${
                config.lastSyncAt ? ` · ${timeAgo(new Date(config.lastSyncAt).toISOString())}` : ''
              } · ${localSessionCount()} sesiones`
            : 'Sin cuentas: un código de pareja y una copia cifrada'
        }
        onClick={() => {
          if (linked) void now();
          else setLink(true);
        }}
      />
      {linked ? (
        <>
          <ListButton
            icon="key"
            title="Ver código de pareja"
            sub="El que hay que escribir en el otro dispositivo"
            onClick={() => setShowCode(true)}
          />
          <ListButton
            icon="x"
            title="Desvincular este dispositivo"
            sub="La copia de la nube no se borra; los datos locales siguen aquí"
            onClick={() => {
              if (!window.confirm('¿Desvincular este dispositivo de la sincronización?')) return;
              unlinkSync();
              toast('Desvinculado', { kind: 'ok' });
            }}
          />
        </>
      ) : null}

      {link ? <LinkModal onClose={() => setLink(false)} /> : null}

      {conflict ? (
        <ConflictModal
          preview={conflict}
          onClose={() => {
            setConflict(null);
            if (busy) setBusy(false);
          }}
        />
      ) : null}

      {showCode && config ? (
        <Modal
          title="Código de pareja"
          sub="Escríbelo en el otro dispositivo (Ajustes → Datos)"
          onClose={() => setShowCode(false)}
          foot={
            <button class="btn" type="button" onClick={() => setShowCode(false)}>
              Hecho
            </button>
          }
        >
          <div class="sync-code">{config.code}</div>
          <div class="tiny muted mt-s">
            Con este código (y el servidor de abajo) el otro dispositivo podrá bajar y fusionar tus
            datos. Guárdalo en un sitio seguro: es la única llave.
          </div>
          <div class="tiny muted mt-s">Servidor: {config.url}</div>
          <button class="btn ghost mt" type="button" onClick={() => copyText(config.code)}>
            Copiar código
          </button>
        </Modal>
      ) : null}
    </>
  );
}
