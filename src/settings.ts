/// <reference types="chrome" />
/** The Google account VidFlow expects Flow to be signed in to. */
export const DEFAULT_EXPECTED_ACCOUNT = 'unscripted4ce@gmail.com';
const EXPECTED_ACCOUNT_KEY = 'expectedAccount';

export async function getExpectedAccount(): Promise<string> {
  const value = (await chrome.storage.local.get(EXPECTED_ACCOUNT_KEY))[EXPECTED_ACCOUNT_KEY];
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_EXPECTED_ACCOUNT;
}

/** "Show live activity in Flow": the ring, tags and badges on the Flow page (the pill always shows). On by default. */
export const LIVE_ACTIVITY_KEY = 'vidflow.liveActivity';

export async function getLiveActivity(): Promise<boolean> {
  return (await chrome.storage.local.get(LIVE_ACTIVITY_KEY))[LIVE_ACTIVITY_KEY] !== false;
}

export async function setLiveActivity(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [LIVE_ACTIVITY_KEY]: on });
}
