import type { Actor } from '../types/production';

const SESSION_KEY = 'abrams_production_actor';

const PIN_TO_ACTOR: Record<string, Actor> = {
  '1122': 'todd',
  '8633': 'ty',
};

export function resolveActorFromPin(pin: string): Actor | null {
  return PIN_TO_ACTOR[pin] ?? null;
}

export function storeActor(actor: Actor): void {
  sessionStorage.setItem(SESSION_KEY, actor);
}

export function getStoredActor(): Actor | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (raw === 'todd' || raw === 'ty') return raw;
  return null;
}

export function clearStoredActor(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
