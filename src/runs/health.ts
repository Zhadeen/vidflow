/**
 * The health line under the side panel's header (spec §19): "✓ Signed in · ✓ Flow ready · ✓ Hero attached", each
 * turning into a plain warning when it fails. Pure, so the panel can use it without the background's modules.
 */
import type { CheckRow } from './checks';

export const FLOW_NOT_OPEN = "VidFlow's Flow window not open";

/** The health line under the panel's header: "✓ Signed in · ✓ Flow ready · ✓ Hero attached", or plain warnings. */
export function healthLine(rows: CheckRow[], flowOpen: boolean): string[] {
  if (!flowOpen) return [FLOW_NOT_OPEN];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  const account = byId.get('account');
  if (account?.ok === true) out.push('✓ Signed in');
  else if (account?.ok === false) out.push(account.detail === 'Not signed in' ? 'Not signed in' : 'Wrong Google account');

  const page = byId.get('page');
  if (page?.ok === false) out.push('Flow needs a look');
  else if (byId.get('promptBox')?.ok === false || byId.get('generate')?.ok === false) out.push('Flow page not ready');
  else if (page?.ok === true) out.push('✓ Flow ready');

  const hero = byId.get('hero');
  if (hero?.ok === true) out.push('✓ Hero attached');
  else if (hero?.ok === false) out.push('Hero picture missing');
  return out;
}
