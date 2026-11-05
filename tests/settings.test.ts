import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPECTED_ACCOUNT, getExpectedAccount } from '../src/settings';

function mockStorage(data: Record<string, unknown>) {
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async (key: string) => ({ [key]: data[key] })) } } });
}

beforeEach(() => vi.unstubAllGlobals());

describe('getExpectedAccount', () => {
  it('defaults to unscripted4ce@gmail.com', async () => {
    mockStorage({});
    expect(DEFAULT_EXPECTED_ACCOUNT).toBe('unscripted4ce@gmail.com');
    expect(await getExpectedAccount()).toBe('unscripted4ce@gmail.com');
  });

  it('reads the expectedAccount setting', async () => {
    mockStorage({ expectedAccount: ' Someone@Example.com ' });
    expect(await getExpectedAccount()).toBe('Someone@Example.com');
  });
});
