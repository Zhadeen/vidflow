import { registerCoordinator } from '../runs/coordinator';

export default defineBackground(() => {
  registerCoordinator();

  const studioUrl = browser.runtime.getURL('/studio.html');

  browser.action.onClicked.addListener(async () => {
    const [existing] = await browser.tabs.query({ url: studioUrl });
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await browser.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    await browser.tabs.create({ url: studioUrl });
  });
});
