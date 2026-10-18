// Idle detection: after 15 minutes with no activity, set presence to 'idle'
// (unless the user chose DND/invisible). Resumes to 'online' on activity.
import { sessionStore, updateMyProfile } from './session';

const IDLE_MS = 15 * 60 * 1000;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let wasIdle = false;

export function startIdleDetection() {
  if (started) return;
  started = true;
  const bump = () => {
    if (wasIdle) {
      wasIdle = false;
      const me = sessionStore.get().me;
      if (me && me.presence === 'idle') {
        void updateMyProfile({ presence: 'online' }).catch(() => {});
      }
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(goIdle, IDLE_MS);
  };
  const goIdle = () => {
    const me = sessionStore.get().me;
    if (!me) return;
    if (me.presence === 'dnd' || me.presence === 'invisible') return;
    wasIdle = true;
    void updateMyProfile({ presence: 'idle' }).catch(() => {});
  };
  const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'visibilitychange'];
  for (const ev of events) window.addEventListener(ev, bump, { passive: true });
  bump();
}

export function stopIdleDetection() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}