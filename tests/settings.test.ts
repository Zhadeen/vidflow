import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPECTED_ACCOUNT,
  getAcceptNotices,
  getAutoSave,
  getExpectedAccount,
  getKeepAwake,
  getLiveActivity,
  getNamingFormat,
  LIVE_ACTIVITY_KEY,
  setAcceptNotices,
  setAutoSave,
  setKeepAwake,
  setLiveActivity,
  setNamingFormat,
} from '../src/settings';

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

describe('global settings', () => {
  function memoryStorage() {
    const data: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(data, items)),
        },
      },
    });
    return data;
  }

  it('defaults: accept notices on, keep awake on, auto-save off, naming slide-time', async () => {
    memoryStorage();
    expect(await getAcceptNotices()).toBe(true);
    expect(await getKeepAwake()).toBe(true);
    expect(await getAutoSave()).toBe(false);
    expect(await getNamingFormat()).toBe('slide-time');
  });

  it('round-trips each setting under its own key', async () => {
    const data = memoryStorage();
    await setAcceptNotices(false);
    await setKeepAwake(false);
    await setAutoSave(true);
    await setNamingFormat('time-slide');
    expect(data).toEqual({
      'vidflow.acceptNotices': false,
      'vidflow.keepAwake': false,
      'vidflow.autoSave': true,
      'vidflow.namingFormat': 'time-slide',
    });
    expect(await getAcceptNotices()).toBe(false);
    expect(await getKeepAwake()).toBe(false);
    expect(await getAutoSave()).toBe(true);
    expect(await getNamingFormat()).toBe('time-slide');
    await setAcceptNotices(true);
    await setKeepAwake(true);
    await setAutoSave(false);
    expect([await getAcceptNotices(), await getKeepAwake(), await getAutoSave()]).toEqual([true, true, false]);
  });

  it('falls back to slide-time for an unknown naming format', async () => {
    const data = memoryStorage();
    data['vidflow.namingFormat'] = 'nonsense';
    expect(await getNamingFormat()).toBe('slide-time');
  });
});
