import type { KeyboardEvent } from 'react';

export type PanelTab = 'setup' | 'queue' | 'checks' | 'files';

interface Props {
  /** Prefix for the tab and panel ids (useId). */
  idBase: string;
  tabs: { id: PanelTab; label: string }[];
  value: PanelTab;
  onChange(tab: PanelTab): void;
}

export const tabId = (idBase: string, tab: PanelTab) => `${idBase}-tab-${tab}`;
export const panelId = (idBase: string, tab: PanelTab) => `${idBase}-panel-${tab}`;

/** Setup · Queue N · Checks · Files: a tab list with arrow keys, Home and End (the selected tab is the one stop). */
export function Tabs({ idBase, tabs, value, onChange }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const at = tabs.findIndex((t) => t.id === value);
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = tabs[to]!.id;
    onChange(next);
    document.getElementById(tabId(idBase, next))?.focus();
  }

  return (
    <div className="vf-pn-tabs" role="tablist" aria-label="VidFlow">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={tabId(idBase, t.id)}
          className="vf-pn-tab"
          aria-selected={t.id === value}
          aria-controls={panelId(idBase, t.id)}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={onKeyDown}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
