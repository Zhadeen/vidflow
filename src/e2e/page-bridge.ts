// DEVELOPMENT-ONLY (e2e build): lets a script in the Flow page drive VidFlow through window.postMessage.
// Marker: vidflow-e2e
export const E2E_PAGE_TYPE = 'vidflow-e2e';
export const E2E_RESULT_TYPE = 'vidflow-e2e-result';

const ACTIONS: Record<string, string> = { start: 'e2e/start', status: 'e2e/status', picture: 'e2e/picture' };

export function installPageBridge(
  win: Window,
  send: (message: Record<string, unknown>) => Promise<unknown>,
): void {
  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win) return;
    const data = event.data as { type?: string; action?: string } & Record<string, unknown>;
    if (!data || data.type !== E2E_PAGE_TYPE || typeof data.action !== 'string') return;
    const action = data.action;
    const type = ACTIONS[action];
    const reply = (body: Record<string, unknown>) => win.postMessage({ type: E2E_RESULT_TYPE, action, ...body }, '*');
    if (!type) return reply({ ok: false, error: `Unknown action "${action}".` });
    const { type: _t, action: _a, ...rest } = data;
    send({ ...rest, type }).then(
      (r) => {
        const res = r as { ok?: boolean; data?: unknown; error?: string } | undefined;
        if (res?.ok) reply({ ok: true, data: res.data });
        else reply({ ok: false, error: res?.error ?? 'No answer from VidFlow.' });
      },
      (e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  });
}
