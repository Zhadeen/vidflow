/**
 * Under the header on every tab: "✓ Signed in · ✓ Flow ready · ✓ Hero attached", each a plain warning when it fails
 * (healthLine in src/runs/health.ts). Before the first check it says it is checking.
 */
export function HealthLine({ items }: { items: string[] | null }) {
  return (
    <div className="vf-pn-health" role="status" aria-label="Health">
      {items === null ? (
        <span className="vf-pn-health-wait">Checking Flow…</span>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item} data-ok={item.startsWith('✓') || undefined}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
