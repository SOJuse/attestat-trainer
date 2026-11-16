import { beforeEach, describe, expect, it } from 'vitest';
import { browserStore } from './storeBrowser';

describe('browserStore', () => {
  beforeEach(() => localStorage.clear());

  it('без сохранённых данных отдаёт null', async () => {
    expect(await browserStore.load()).toBeNull();
  });

  it('возвращает то, что сохранили последним', async () => {
    await browserStore.save('{"a":1}');
    await browserStore.save('{"a":2}');
    expect(await browserStore.load()).toBe('{"a":2}');
  });
});
