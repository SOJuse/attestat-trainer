import type { Platform } from './Platform';

/** Управляемая подделка для тестов. */
export function createFakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    appVersion: async () => '0.0.0-test',
    checkAppUpdate: async () => null,
    installAppUpdate: async () => {},
    openExternal: async () => {},
    ...overrides,
  };
}
