// WhatsApp connection band hone pe kya karna hai — pure function (test ho sakta hai).
import { DisconnectReason } from 'baileys';

const MAX_BACKOFF = 60_000;

/**
 * @returns {{ status: string, clearSession: boolean, delayMs: number }}
 *   delayMs = kitni der baad reconnect. Infinity = khud reconnect mat karo.
 */
export function decideOnClose(code, attempt = 0) {
  switch (code) {
    case DisconnectReason.loggedOut: // 401 — phone se unlink / revoke. Naya QR chahiye.
      return { status: 'logged_out', clearSession: true, delayMs: 1_000 };
    case DisconnectReason.restartRequired: // 515 — QR scan ke baad normal.
      return { status: 'reconnecting', clearSession: false, delayMs: 0 };
    case DisconnectReason.connectionReplaced: // 440 — dusra connection isi session pe.
      return { status: 'replaced', clearSession: false, delayMs: 60_000 };
    case DisconnectReason.forbidden: // 403 — number restricted/banned. Session mat mitao.
      return { status: 'forbidden', clearSession: false, delayMs: 10 * 60_000 };
    default: // 408, 428, 500, 503, network — temporary.
      return {
        status: 'reconnecting',
        clearSession: false,
        delayMs: Math.min(MAX_BACKOFF, 2_000 * 2 ** attempt),
      };
  }
}
