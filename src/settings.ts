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

/** Global switches from the Settings panel (spec §19). All live in chrome.storage.local, like the live-activity switch. */
export const ACCEPT_NOTICES_KEY = 'vidflow.acceptNotices';
export const KEEP_AWAKE_KEY = 'vidflow.keepAwake';
export const AUTO_SAVE_KEY = 'vidflow.autoSave';
export const NAMING_FORMAT_KEY = 'vidflow.namingFormat';

export type NamingFormat = 'slide-time' | 'slide-timecode' | 'slide-seconds' | 'time-slide' | 'slide';
export const NAMING_FORMATS: readonly NamingFormat[] = ['slide-time', 'slide-timecode', 'slide-seconds', 'time-slide', 'slide'];
export const DEFAULT_NAMING_FORMAT: NamingFormat = 'slide-time';

const read = async (key: string): Promise<unknown> => (await chrome.storage.local.get(key))[key];
const write = (key: string, value: unknown): Promise<void> => chrome.storage.local.set({ [key]: value });

/** "Accept Flow's notices automatically": VidFlow ticks and accepts Flow's usage-policy / rights notices. On by default. */
export async function getAcceptNotices(): Promise<boolean> {
  return (await read(ACCEPT_NOTICES_KEY)) !== false;
}
export async function setAcceptNotices(on: boolean): Promise<void> {
  await write(ACCEPT_NOTICES_KEY, on);
}

/** "Keep Mac awake while running". On by default. */
export async function getKeepAwake(): Promise<boolean> {
  return (await read(KEEP_AWAKE_KEY)) !== false;
}
export async function setKeepAwake(on: boolean): Promise<void> {
  await write(KEEP_AWAKE_KEY, on);
}

/** Save finished pictures to the Mac on their own. Off by default. */
export async function getAutoSave(): Promise<boolean> {
  return (await read(AUTO_SAVE_KEY)) === true;
}
export async function setAutoSave(on: boolean): Promise<void> {
  await write(AUTO_SAVE_KEY, on);
}

/** How saved pictures are named. 'slide-time' by default; anything unknown reads as the default. */
export async function getNamingFormat(): Promise<NamingFormat> {
  const value = await read(NAMING_FORMAT_KEY);
  return NAMING_FORMATS.includes(value as NamingFormat) ? (value as NamingFormat) : DEFAULT_NAMING_FORMAT;
}
export async function setNamingFormat(f: NamingFormat): Promise<void> {
  await write(NAMING_FORMAT_KEY, f);
}

/** Files tab: download both options of each scene (the chosen one plainly named, the other "_option2"). Off by default. */
export const DOWNLOAD_BOTH_KEY = 'vidflow.downloadBoth';
export async function getDownloadBoth(): Promise<boolean> {
  return (await read(DOWNLOAD_BOTH_KEY)) === true;
}
export async function setDownloadBoth(on: boolean): Promise<void> {
  await write(DOWNLOAD_BOTH_KEY, on);
}
