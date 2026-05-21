import { describe, it, expect, beforeEach } from 'vitest';
import { resolveActorFromPin, getStoredActor, storeActor, clearStoredActor } from './actor';

describe('resolveActorFromPin', () => {
  it('returns todd for 1122', () => {
    expect(resolveActorFromPin('1122')).toBe('todd');
  });
  it('returns ty for 8633', () => {
    expect(resolveActorFromPin('8633')).toBe('ty');
  });
  it('returns null for unknown PIN', () => {
    expect(resolveActorFromPin('0000')).toBeNull();
    expect(resolveActorFromPin('')).toBeNull();
  });
});

describe('actor sessionStorage helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips an actor', () => {
    storeActor('todd');
    expect(getStoredActor()).toBe('todd');
  });
  it('clearStoredActor removes the value', () => {
    storeActor('ty');
    clearStoredActor();
    expect(getStoredActor()).toBeNull();
  });
  it('ignores junk values in storage', () => {
    sessionStorage.setItem('abrams_production_actor', 'eve');
    expect(getStoredActor()).toBeNull();
  });
});
