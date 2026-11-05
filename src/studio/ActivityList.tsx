/// <reference types="chrome" />
import { useEffect, useState } from 'react';
import { ACTIVITY_KEY, readActivity, sceneNumber, stepLine, type ActivityEntry } from '../runs/activity';
import { getLiveActivity, setLiveActivity } from '../settings';
import type { Project } from '../store/projects';

const DEFAULT_LIMIT = 50;
const pad = (n: number) => String(n).padStart(2, '0');

function clock(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  projectId: string;
  limit?: number;
  /** Lets "Scene N" use the same numbers as the scene grid; without it, lines show just what happened. */
  project?: Pick<Project, 'scenes'>;
}

/** What VidFlow is doing, newest first, plus the switch for the highlights on the Flow page. */
export function ActivityList({ projectId, limit = DEFAULT_LIMIT, project }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return; // outside the extension (screenshots): nothing to show
    let alive = true;
    const load = () =>
      readActivity(projectId, limit).then(
        (list) => alive && setEntries(list),
        () => undefined,
      );
    void load();
    getLiveActivity().then(
      (on) => alive && setLive(on),
      () => undefined,
    );
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && ACTIVITY_KEY in changes) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [projectId, limit]);

  function toggle() {
    const next = !live;
    setLive(next);
    setLiveActivity(next).catch(() => setLive(!next));
  }

  return (
    <section className="vf-activity" aria-label="Activity">
      <div className="vf-activity-head">
        <h2 className="vf-h2">Activity</h2>
        <span className="vf-switch-row">
          <span id="vf-live-label">Show live activity in Flow</span>
          <button
            type="button"
            role="switch"
            aria-checked={live}
            aria-labelledby="vf-live-label"
            className="vf-switch"
            onClick={toggle}
          >
            <span className="vf-switch-knob" />
          </button>
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="vf-hint" style={{ margin: 0 }}>
          Nothing yet — press Start to begin.
        </p>
      ) : (
        <ul className="vf-activity-list">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="vf-activity-time">{clock(e.at)}</span>
              <span>{project ? stepLine(sceneNumber(project, e.sceneId), e.text) : e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
