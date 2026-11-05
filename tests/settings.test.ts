import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPECTED_ACCOUNT, getExpectedAccount, getLiveActivity, LIVE_ACTIVITY_KEY, setLiveActivity } from '../src/settings';

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

describe('live activity switch', () => {
  it('is on by default, and remembers off', async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(data, items)),
        },
      },
    });
    expect(LIVE_ACTIVITY_KEY).toBe('vidflow.liveActivity');
    expect(await getLiveActivity()).toBe(true);
    await setLiveActivity(false);
    expect(data[LIVE_ACTIVITY_KEY]).toBe(false);
    expect(await getLiveActivity()).toBe(false);
    await setLiveActivity(true);
    expect(await getLiveActivity()).toBe(true);
  });
});
