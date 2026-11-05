/// <reference types="chrome" />
/** The Google account VidFlow expects Flow to be signed in to. */
export const DEFAULT_EXPECTED_ACCOUNT = 'unscripted4ce@gmail.com';
const EXPECTED_ACCOUNT_KEY = 'expectedAccount';

export async function getExpectedAccount(): Promise<string> {
  const value = (await chrome.storage.local.get(EXPECTED_ACCOUNT_KEY))[EXPECTED_ACCOUNT_KEY];
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_EXPECTED_ACCOUNT;
}
