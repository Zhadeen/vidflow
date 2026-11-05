/// <reference types="chrome" />
import { useEffect, useId, useState } from 'react';
import type { CheckId, CheckRow } from '../runs/checks';
import {
  ACCEPT_NOTICES_KEY,
  AUTO_SAVE_KEY,
  getAcceptNotices,
  getAutoSave,
  getKeepAwake,
  KEEP_AWAKE_KEY,
  setAcceptNotices,
  setAutoSave,
  setKeepAwake,
} from '../settings';
import type { Project } from '../store/projects';
import { Button } from '../studio/Button';
import type { RunClient } from '../studio/runClient';

/** The latest read of VidFlow's Flow tab, as the panel keeps it (it also feeds the health line). */
export interface ChecksResult {
  flowOpen: boolean;
  rows: CheckRow[];
  /** When it was read (Date.now()). */
  at: number;
}

const BADGE: Record<CheckId, string> = {
  account: '✓ Signed in',
  page: '✓ Ready',
  promptBox: '✓ Found',
  generate: '✓ Found',
  agentOff: '✓ Off',
  settings: '✓ Match',
  hero: '✓ Ready',
  credits: '✓ 0 needed',
};
/** Rows the run puts right itself when it starts (agent mode, Flow's settings): a problem there doesn't stop Start. */
const SET_AT_START = new Set<CheckId>(['agentOff', 'settings']);
const REQUEST_FAILED = 'Something went wrong — try again.';

/** What a row reads as, as in the approved panel ("Google account · unscripted4ce", "Credits · 1,043"). */
function title(row: CheckRow): string {
  const label = row.id === 'agentOff' ? 'Agent mode' : row.label;
  if (row.ok !== true) return label;
  // The account by its name only, as in the approved panel ("unscripted4ce"): the full address doesn't fit beside the badge.
  if (row.id === 'account') return `${label} · ${row.detail.replace(/@.*$/, '')}`;
  if (row.id === 'settings') return `${label} · ${row.detail}`;
  if (row.id === 'credits') {
    const m = /^([\d.,]+) credits( \(resets [^)]+\))?/.exec(row.detail);
    return m ? `${label} · ${m[1]}${m[2] ?? ''}` : label;
  }
  return label;
}

/** "checked 12:24": the time of the last read. */
const when = (at: number) => `checked ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

/** "the prompt box", "the prompt box and the Generate button", "a, b and c". */
function names(list: string[]): string {
  const the = list.map((n) => `the ${n}`);
  return the.length <= 1 ? (the[0] ?? '') : `${the.slice(0, -1).join(', ')} and ${the.at(-1)}`;
}

/** A switch bound to one stored setting. null = not read yet: shown off and disabled, so it can't be flipped blind. */
export function Switch({ label, on, onChange }: { label: string; on: boolean | null; onChange(on: boolean): void }) {
  const id = useId();
  return (
    <li className="vf-pn-check">
      <span id={id}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-labelledby={id}
        className="vf-switch"
        disabled={on === null}
        onClick={() => on !== null && onChange(!on)}
      >
        <span className="vf-switch-knob" />
      </button>
    </li>
  );
}

/**
 * A stored on/off setting (on by default unless `defaultOn` is false): null until read; a change from anywhere (this
 * panel, the studio, another panel) comes in through chrome.storage.onChanged, and a read that arrives after such a
 * change never overwrites it.
 */
export function useStoredSwitch(key: string, read: () => Promise<boolean>, defaultOn = true): [boolean | null, (on: boolean) => void] {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    read().then(
      (v) => alive && setOn((now) => now ?? v),
      () => undefined,
    );
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && key in changes) {
        const value = changes[key]!.newValue;
        setOn(defaultOn ? value !== false : value === true);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [key, read, defaultOn]);
  return [on, setOn];
}

interface Props {
  project: Project;
  client: RunClient;
  result: ChecksResult | null;
  checking: boolean;
  error: string | null;
  /** Reads VidFlow's Flow tab again (Check again, and after Open Flow / Test one prompt). */
  onCheck(): void;
}

/**
 * Checks (spec §19): what VidFlow read from its own Flow tab, row by row, the automation switches, Show me in
 * Flow, Test one prompt and the coral Check again.
 */
export function PanelChecks({ project, client, result, checking, error, onCheck }: Props) {
  const ids = useId();
  const [notices, setNotices] = useStoredSwitch(ACCEPT_NOTICES_KEY, getAcceptNotices);
  const [awake, setAwake] = useStoredSwitch(KEEP_AWAKE_KEY, getKeepAwake);
  const [autoSave, setAutoSaveOn] = useStoredSwitch(AUTO_SAVE_KEY, getAutoSave, false);
  const [tool, setTool] = useState<null | 'open' | 'show' | 'test'>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  function flip(set: (on: boolean) => void, save: (on: boolean) => Promise<void>, on: boolean) {
    set(on);
    save(on).catch(() => {
      set(!on);
      setMessage({ text: "VidFlow couldn't save that switch. Try again.", problem: true });
    });
  }

  async function use(kind: 'open' | 'show' | 'test') {
    setTool(kind);
    setMessage(null);
    try {
      if (kind === 'open') {
        const reply = await client.openFlow();
        if (!reply.ok) setMessage({ text: reply.message, problem: true });
        onCheck();
      } else if (kind === 'show') {
        const reply = await client.showMe();
        if (!reply.ok) setMessage({ text: reply.message, problem: true });
        else if (reply.missing.length === 0)
          setMessage({ text: 'Look at Flow: the prompt box, Generate and the ingredients button are ringed.', problem: false });
        else setMessage({ text: `Look at Flow: VidFlow couldn't find ${names(reply.missing)}.`, problem: false });
      } else {
        const reply = await client.testPrompt(project.id);
        setMessage({ text: reply.message, problem: !reply.ok });
        onCheck();
      }
    } catch {
      setMessage({ text: REQUEST_FAILED, problem: true });
    } finally {
      setTool(null);
    }
  }

  const flowOpen = result?.flowOpen ?? true;
  const heading =
    result && result.flowOpen
      ? `Before starting — ${when(result.at)}`
      : checking && !result
        ? 'Before starting — checking…'
        : 'Before starting — not checked yet';

  return (
    <>
      <p className="vf-pn-label" id={`${ids}-checks`}>
        {heading}
      </p>
      {!flowOpen && (
        <div className="vf-pn-flow-closed">
          <p className="vf-pn-sub">VidFlow's Flow window isn't open. Open it to check.</p>
          <Button className="vf-pn-sec" onClick={() => void use('open')} loading={tool === 'open'} disabled={tool !== null}>
            Open Flow
          </Button>
        </div>
      )}
      <ul className="vf-pn-checks" aria-label="Checks">
        {(result?.rows ?? []).map((row) =>
          row.ok === true ? (
            <li key={row.id} className="vf-pn-check" data-ok="true">
              <span>{title(row)}</span>
              <span className="vf-pn-badge">{BADGE[row.id]}</span>
            </li>
          ) : row.ok === false ? (
            <li key={row.id} className="vf-pn-check" data-ok="false">
              <span className="vf-pn-check-text">
                <span>{title(row)}</span>
                <span className="vf-pn-check-problem">{row.detail}</span>
                {row.fix && <span className="vf-pn-check-fix">{row.fix}</span>}
              </span>
              <span className="vf-pn-badge" data-tone="warn">
                {SET_AT_START.has(row.id) ? 'Set at start' : 'Not ready'}
              </span>
            </li>
          ) : (
            <li key={row.id} className="vf-pn-check" data-ok="unknown">
              <span>{title(row)}</span>
              <span className="vf-pn-check-idle">{row.detail}</span>
            </li>
          ),
        )}
      </ul>

      <p className="vf-pn-label vf-pn-label-gap">Automation</p>
      <ul className="vf-pn-checks" aria-label="Automation">
        <Switch label="Accept Flow's notices automatically" on={notices} onChange={(on) => flip(setNotices, setAcceptNotices, on)} />
        <Switch label="Keep Mac awake while running" on={awake} onChange={(on) => flip(setAwake, setKeepAwake, on)} />
        <Switch label="Save automatically as each scene finishes" on={autoSave} onChange={(on) => flip(setAutoSaveOn, setAutoSave, on)} />
      </ul>

      <div className="vf-pn-pair">
        <Button className="vf-pn-sec" onClick={() => void use('show')} loading={tool === 'show'} disabled={tool !== null}>
          Show me in Flow
        </Button>
        <Button className="vf-pn-sec" onClick={() => void use('test')} loading={tool === 'test'} disabled={tool !== null}>
          Test one prompt
        </Button>
      </div>

      {message && (
        <p className={message.problem ? 'vf-notice vf-pn-notice' : 'vf-pn-sub'} role={message.problem ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {error && (
        <p className="vf-notice vf-pn-notice" role="alert">
          {error}
        </p>
      )}

      <div className="vf-pn-actions vf-pn-end">
        <Button variant="primary" onClick={onCheck} loading={checking}>
          Check again
        </Button>
      </div>
    </>
  );
}
