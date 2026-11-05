import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCanStart, createFlowDriver, type FlowPageState } from '../../src/flow/driver';
import { SEL } from '../../src/flow/selectors';

const fixture = (name: string) => readFileSync(resolve(__dirname, '../fixtures/flow', name), 'utf8');
const load = (...names: string[]) => {
  document.body.innerHTML = names.map(fixture).join('\n');
};
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Stand-in for Flow's editor: execCommand is what the spike proved works on the real page; jsdom has none. */
function fakeEditor() {
  const exec = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
    if (cmd === 'selectAll') return true;
    if (cmd === 'insertText') {
      const box = document.querySelector<HTMLElement>(SEL.promptBox)!; // the real command acts on the focused box
      box.innerHTML = `<p>${value ?? ''}</p>`;
      return true;
    }
    return false;
  });
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  return exec;
}

/** Stand-in for Flow's settings radios: clicking one checks it and updates the trigger text. */
function fakeRadios() {
  const icons: Record<string, string> = { '16:9': 'crop_16_9', '1:1': 'crop_square', '9:16': 'crop_9_16' };
  document.querySelectorAll<HTMLElement>('[role="radio"]').forEach((radio) =>
    radio.addEventListener('click', () => {
      radio.parentElement!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', 'false'));
      radio.setAttribute('aria-checked', 'true');
      const trigger = $(SEL.settingsTrigger);
      const label = radio.textContent!.trim().split(' ').pop()!;
      if (icons[label]) trigger.innerHTML = trigger.innerHTML.replace(/crop_(16_9|9_16|square|landscape|portrait)/, icons[label]);
      if (/^x\d$/.test(label)) trigger.innerHTML = trigger.innerHTML.replace(/x\d/, label);
    }),
  );
}

const idle: FlowPageState = {
  ready: true,
  signedInEmail: 'unscripted4ce@gmail.com',
  generating: false,
  limitMessage: null,
  policyDialog: false,
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FlowDriver.read', () => {
  it('reads idle page as ready', () => {
    load('prompt-bar.html');
    expect(createFlowDriver().read()).toEqual({
      ready: true,
      signedInEmail: 'owner@example.com',
      generating: false,
      limitMessage: null,
      policyDialog: false,
    });
  });

  it('reads generating while a tile shows a percentage', () => {
    load('prompt-bar.html', 'tiles.html');
    expect(createFlowDriver().read().generating).toBe(true);
  });

  it('reads a limit message, ignoring the "will use 0 credits" note', () => {
    load('prompt-bar.html', 'messages.html');
    expect(createFlowDriver().read().limitMessage).toBe(
      "You've reached your daily generation quota. Please try again later.",
    );
  });

  it('reads a policy or billing dialog', () => {
    load('prompt-bar.html', 'policy-dialog.html');
    const state = createFlowDriver().read();
    expect(state.policyDialog).toBe(true);
    expect(state.limitMessage).toBeNull();
  });

  it('reads a page without the prompt box as not ready', () => {
    document.body.innerHTML = '<button>New project</button>';
    expect(createFlowDriver().read()).toMatchObject({ ready: false, signedInEmail: null });
  });
});

describe('checkCanStart', () => {
  it('allows the expected account, ignoring case', () => {
    expect(checkCanStart({ ...idle, signedInEmail: 'Unscripted4ce@Gmail.com' }, 'unscripted4ce@gmail.com')).toEqual({
      ok: true,
    });
  });

  it('blocks start when signed in to a different account', () => {
    expect(checkCanStart({ ...idle, signedInEmail: 'someone@example.com' }, 'unscripted4ce@gmail.com')).toEqual({
      ok: false,
      reason: 'wrong-account',
      message:
        'Flow is signed in to someone@example.com, but VidFlow is set to use unscripted4ce@gmail.com. Switch Flow to unscripted4ce@gmail.com, then press Start again.',
    });
  });

  it('blocks start when signed out', () => {
    expect(checkCanStart({ ...idle, signedInEmail: null }, 'unscripted4ce@gmail.com')).toMatchObject({
      ok: false,
      reason: 'signed-out',
    });
  });

  it('blocks start while a policy dialog shows', () => {
    expect(checkCanStart({ ...idle, policyDialog: true }, 'unscripted4ce@gmail.com')).toMatchObject({
      ok: false,
      reason: 'policy-dialog',
    });
  });

  it('names Resume when asked to, keeping the wording otherwise', () => {
    expect(checkCanStart({ ...idle, signedInEmail: 'someone@example.com' }, 'unscripted4ce@gmail.com', 'Resume')).toEqual({
      ok: false,
      reason: 'wrong-account',
      message:
        'Flow is signed in to someone@example.com, but VidFlow is set to use unscripted4ce@gmail.com. Switch Flow to unscripted4ce@gmail.com, then press Resume.',
    });
    for (const s of [{ ...idle, signedInEmail: null }, { ...idle, policyDialog: true }, { ...idle, ready: false }]) {
      const check = checkCanStart(s, 'unscripted4ce@gmail.com', 'Resume');
      expect(check.ok ? '' : check.message).toMatch(/then press Resume\.$/);
    }
  });

  it('blocks start on a page it does not recognise', () => {
    expect(checkCanStart({ ...idle, ready: false }, 'unscripted4ce@gmail.com')).toMatchObject({
      ok: false,
      reason: 'page-not-recognised',
    });
  });
});

describe('FlowDriver settings', () => {
  it('sets aspect and outputs with the radios and confirms on the trigger', async () => {
    load('prompt-bar.html');
    fakeRadios();
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 200 });
    await driver.setAspect('16:9');
    await driver.setOutputs(4);
    expect($(SEL.settingsTrigger).textContent).toContain('crop_16_9');
    expect($(SEL.settingsTrigger).textContent).toContain('x4');
  });

  it('switches Flow to Image and confirms the radio is checked', async () => {
    load('prompt-bar.html');
    fakeRadios();
    const image = [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent!.includes('Image'))!;
    const video = [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent!.includes('Video'))!;
    image.setAttribute('aria-checked', 'false');
    video.setAttribute('aria-checked', 'true');
    await createFlowDriver(document, { pollMs: 5, timeoutMs: 200 }).setImageMode();
    expect(image.getAttribute('aria-checked')).toBe('true');
    expect(video.getAttribute('aria-checked')).toBe('false');
  });

  it('reads the live radio markup, whose icon name runs into the label', async () => {
    // Live Flow (5 Nov 2026): textContent is "imageImage", "videocamVideo", "crop_16_916:9".
    const radio = (icon: string | null, text: string, checked: boolean) =>
      `<button role="radio" aria-checked="${checked}"><span class="mat-button-toggle-label-content"><span class="toggle-label">${
        icon ? `<mat-icon aria-hidden="true" data-mat-icon-type="font">${icon}</mat-icon>` : ''
      }<span class="toggle-text">${text}</span></span></span></button>`;
    document.body.innerHTML = `<button aria-label="Settings trigger">Video · 720p · 4s crop_16_9 x1</button>
      <div role="radiogroup">${radio('image', 'Image', false)}${radio('videocam', 'Video', true)}</div>`;
    const [image, video] = document.querySelectorAll<HTMLElement>('[role="radio"]');
    image.addEventListener('click', () => {
      image.setAttribute('aria-checked', 'true');
      video.setAttribute('aria-checked', 'false');
    });
    await createFlowDriver(document, { pollMs: 5, timeoutMs: 200 }).setImageMode();
    expect(image.getAttribute('aria-checked')).toBe('true');
  });

  it('fails when Image does not take', async () => {
    load('prompt-bar.html'); // no fake radios
    const image = [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent!.includes('Image'))!;
    image.setAttribute('aria-checked', 'false');
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).setImageMode()).rejects.toThrow(/Image/);
  });

  it('opens the settings popover when it is closed', async () => {
    load('prompt-bar.html');
    fakeRadios();
    const popover = $('.settings-popover');
    popover.remove();
    $(SEL.settingsTrigger).addEventListener('click', () => {
      if (!document.body.contains(popover)) document.body.append(popover);
      else popover.remove();
    });
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 200 });
    await driver.setAspect('1:1');
    expect($(SEL.settingsTrigger).textContent).toContain('crop_square');
    expect(document.body.contains(popover)).toBe(false); // closed again afterwards
  });

  it('fails when the setting does not take', async () => {
    load('prompt-bar.html'); // no fake radios: clicks change nothing
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 50 });
    await expect(driver.setAspect('16:9')).rejects.toThrow(/16:9/);
  });
});

describe('FlowDriver.prepareSubmit', () => {
  it('waits for an enabled Generate button and never enables it itself', async () => {
    load('prompt-bar.html');
    const exec = fakeEditor();
    const generate = $<HTMLButtonElement>(SEL.generate);
    const click = vi.spyOn(generate, 'click');
    vi.spyOn(generate, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 600, width: 40, height: 40 } as DOMRect);
    const changes: (string | null)[] = [];
    new MutationObserver((records) => records.forEach((r) => changes.push((r.target as Element).getAttribute('disabled')))).observe(
      generate,
      { attributes: true, attributeFilter: ['disabled'] },
    );

    let result: { x: number; y: number } | undefined;
    const pending = createFlowDriver(document, { pollMs: 5, timeoutMs: 1000 })
      .prepareSubmit('A stickman waves')
      .then((r) => (result = r));
    await tick(40);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'A stickman waves');
    expect($(SEL.promptBox).textContent).toBe('A stickman waves');
    expect(result).toBeUndefined();
    expect(generate.disabled).toBe(true);
    expect(changes).toEqual([]);

    generate.removeAttribute('disabled'); // Flow enables it
    await pending;
    expect(result).toEqual({ x: 120, y: 620 });
    expect(click).not.toHaveBeenCalled();
    expect(changes).toEqual([null]); // only Flow's own change
  });

  it('gives up when Generate never becomes enabled', async () => {
    load('prompt-bar.html');
    fakeEditor();
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 50 });
    await expect(driver.prepareSubmit('A stickman waves')).rejects.toThrow(/Generate/);
    expect($<HTMLButtonElement>(SEL.generate).disabled).toBe(true);
  });

  it('accepts a multi-paragraph prompt that Flow splits into <p> blocks', async () => {
    // Live Flow (5 Nov 2026): each line becomes a <p>, so textContent glues paragraphs together.
    load('prompt-bar.html');
    const exec = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
      if (cmd === 'insertText') {
        $(SEL.promptBox).innerHTML = (value ?? '').split('\n').map((l) => (l ? `<p>${l}</p>` : '<p><br></p>')).join('');
      }
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    $<HTMLButtonElement>(SEL.generate).removeAttribute('disabled');
    vi.spyOn($(SEL.generate), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 10, height: 10 } as DOMRect);
    const prompt = 'STYLE: whiteboard stickman.\n\nScene: The hero waves.\n\nEnforcement: flat lines only.';
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 200 }).prepareSubmit(prompt)).resolves.toEqual({ x: 5, y: 5 });
  });

  it('fails when the text does not go into the box', async () => {
    load('prompt-bar.html');
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 50 });
    await expect(driver.prepareSubmit('A stickman waves')).rejects.toThrow(/type/);
  });
});

describe('FlowDriver.waitForStart', () => {
  const typed = () => {
    load('prompt-bar.html', 'tiles.html');
    $(SEL.promptBox).innerHTML = '<p>A stickman waves</p>';
    return createFlowDriver(document, { pollMs: 5 });
  };

  it('confirms when Flow clears the prompt box', async () => {
    const driver = typed();
    const snap = driver.snapshot();
    setTimeout(() => ($(SEL.promptBox).innerHTML = '<p><br></p>'), 20);
    expect(await driver.waitForStart(snap, 500)).toBe(true);
  });

  it('confirms when a new in-progress tile appears', async () => {
    const driver = typed();
    const snap = driver.snapshot();
    setTimeout(() => {
      const tile = document.createElement('div');
      tile.innerHTML = '<div>0%</div><span>A stickman waves</span>';
      $(SEL.tileList).prepend(tile);
    }, 20);
    expect(await driver.waitForStart(snap, 500)).toBe(true);
  });

  it('reports false when nothing changes in time', async () => {
    const driver = typed();
    expect(await driver.waitForStart(driver.snapshot(), 50)).toBe(false);
  });
});

describe('FlowDriver home page', () => {
  it('finds the New project button and its centre', () => {
    load('home.html');
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent!.includes('New project'))!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 200, width: 160, height: 48 } as DOMRect);
    const driver = createFlowDriver();
    expect(driver.read()).toMatchObject({ ready: false, signedInEmail: 'owner@example.com' });
    expect(driver.newProjectButton()).toEqual({ x: 120, y: 224 });
  });

  it('finds the live New project button whose icon name runs into its label', () => {
    // Live Flow (5 Nov 2026): <button><mat-icon>add</mat-icon><span>New project</span></button> → textContent "addNew project"; below the fold.
    document.body.innerHTML =
      '<flow-projects-page><button type="button"><mat-icon>add</mat-icon><span>New project</span></button></flow-projects-page>';
    const button = document.querySelector('button')!;
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 1800, width: 192, height: 128 } as DOMRect);
    expect(createFlowDriver().newProjectButton()).toEqual({ x: 96, y: 1864 });
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  });

  it('finds no New project button on a project page', () => {
    load('prompt-bar.html');
    expect(createFlowDriver().newProjectButton()).toBeNull();
  });
});

describe('FlowDriver.resultCards', () => {
  it('lists each card with caption and image', () => {
    load('tiles.html');
    const cards = createFlowDriver().resultCards();
    expect(cards).toHaveLength(5);
    expect(cards[0]).toEqual({
      key: 'pending-0',
      caption: 'A stickman rides a bicycle up a hill, black ink on white paper',
      imageUrl: null,
      progress: 10,
      refusal: null,
      domIndex: 0,
    });
    expect(cards[1]).toEqual({
      key: '5b208a77-5547-4e88-9b51-f74f987f2f0d',
      caption: 'Stickman waving near window',
      imageUrl: 'https://flow-content.google/image/5b208a77-5547-4e88-9b51-f74f987f2f0d',
      progress: null,
      refusal: null,
      domIndex: 1,
    });
    for (const card of cards.slice(1)) {
      expect(card.caption).not.toBe('');
      expect(card.imageUrl).toMatch(/^https:\/\/flow-content\.google\/image\//);
    }
  });

  it('reports a refusal on a card', () => {
    load('messages.html');
    const [refused] = createFlowDriver().resultCards();
    expect(refused).toMatchObject({
      imageUrl: null,
      caption: 'A stickman in a fight, black ink on white paper',
      refusal: 'This prompt might violate our content policy. Try a different prompt.',
    });
  });
});

describe('FlowDriver picture detail', () => {
  const PROMPT = 'A stickman waves from a window, black ink on white paper';
  const ID = '5b208a77-5547-4e88-9b51-f74f987f2f0d';

  it("reads the full prompt and the opened picture's media id from the detail page", () => {
    load('detail.html');
    expect(createFlowDriver().readDetailPrompt()).toEqual({ mediaId: ID, prompt: PROMPT });
  });

  it('reads the first history step (the generation) when there are several', () => {
    load('detail.html');
    const step = document.querySelector('flow-editor-history-step-image')!;
    const edit = step.cloneNode(true) as HTMLElement;
    edit.querySelector('.text-part')!.textContent = 'Make the stickman wave with his other hand';
    step.after(edit);
    expect(createFlowDriver().readDetailPrompt().prompt).toBe(PROMPT);
  });

  it('gives no media id unless exactly one element carries one', () => {
    load('detail.html');
    document.querySelector('[data-media-id]')!.removeAttribute('data-media-id');
    expect(createFlowDriver().readDetailPrompt()).toEqual({ mediaId: null, prompt: PROMPT });
    load('detail.html', 'tiles.html');
    expect(createFlowDriver().readDetailPrompt().mediaId).toBeNull();
  });

  it('gives no prompt when the page is not a detail page', () => {
    load('tiles.html');
    expect(createFlowDriver().readDetailPrompt().prompt).toBeNull();
  });

  it("finds a finished tile's centre to open its detail", () => {
    load('tiles.html');
    const img = document.querySelector<HTMLElement>('img[data-media-id="4ca91b00-de41-44e5-ab6c-85c484c751ab"]')!;
    img.scrollIntoView = vi.fn();
    img.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 20 }) as DOMRect;
    expect(createFlowDriver().tilePoint('4ca91b00-de41-44e5-ab6c-85c484c751ab')).toEqual({ x: 120, y: 210 });
    expect(img.scrollIntoView).toHaveBeenCalled();
    expect(createFlowDriver().tilePoint('not-there')).toBeNull();
  });
});

describe('FlowDriver.attachReference', () => {
  it('says it is not available yet', async () => {
    load('prompt-bar.html');
    await expect(createFlowDriver().attachReference(new Blob(['x']))).rejects.toThrow(
      "Adding a reference picture isn't available yet.",
    );
  });
});
