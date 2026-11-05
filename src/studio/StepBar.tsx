export type StepId = 'script' | 'voice' | 'pictures' | 'motion' | 'edit' | 'export';

export interface StepView {
  id: StepId;
  label: string;
  /** Shown on the active pill, e.g. "38/60". */
  count?: string;
  done: boolean;
  /** Not built yet in this version: shown as plain text, not clickable. */
  comingNext: boolean;
  /** Clickable (built, and reachable from where the project is). */
  enabled: boolean;
}

interface Props {
  steps: StepView[];
  active: StepId;
  onSelect(step: StepId): void;
}

/** Steps across the top (layout C): done = navy pill with ✓, active = cream pill with live count, upcoming = plain text. */
export function StepBar({ steps, active, onSelect }: Props) {
  const later = steps.filter((s) => s.comingNext).map((s) => s.label);
  return (
    <nav className="vf-steps" aria-label="Steps">
      <ol>
        {steps.map((step) => {
          const isActive = step.id === active;
          const state = isActive ? 'active' : step.done ? 'done' : 'upcoming';
          const text = `${step.done && !isActive ? '✓ ' : ''}${step.label}${step.count ? ` ${step.count}` : ''}`;
          return (
            <li key={step.id}>
              {step.comingNext || !step.enabled ? (
                <span
                  className="vf-step"
                  data-state={state}
                  aria-disabled="true"
                  title={step.comingNext ? 'Coming next' : undefined}
                >
                  {text}
                </span>
              ) : (
                <button
                  type="button"
                  className="vf-step"
                  data-state={state}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => onSelect(step.id)}
                >
                  {text}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {later.length > 0 && <p className="vf-steps-note">{listText(later)} are coming next.</p>}
    </nav>
  );
}

function listText(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
