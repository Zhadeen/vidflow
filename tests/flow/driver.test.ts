import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCanStart, createFlowDriver, tileContainer, tileImage, type FlowPageState } from '../../src/flow/driver';
import { FlowBlockedError, STRAY_INGREDIENT_MESSAGE } from '../../src/flow/messages';
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
  noticeDialog: false,
  billingDialog: false,
  announcement: false,
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
      noticeDialog: false,
      billingDialog: false,
      announcement: false,
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

  it('reads a usage notice and a billing dialog apart', () => {
    load('prompt-bar.html', 'usage-notice.html');
    expect(createFlowDriver().read()).toMatchObject({ noticeDialog: true, billingDialog: false, limitMessage: null });
    load('prompt-bar.html', 'billing-dialog.html');
    expect(createFlowDriver().read()).toMatchObject({ noticeDialog: false, billingDialog: true, limitMessage: null });
    // Billing wording wins: a dialog that also names the usage policy is never treated as a notice.
    load('prompt-bar.html', 'policy-dialog.html');
    expect(createFlowDriver().read()).toMatchObject({ noticeDialog: false, billingDialog: true });
    // An unknown dialog is neither.
    load('prompt-bar.html');
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><p>Welcome to Flow</p><button>Got it</button></div>');
    expect(createFlowDriver().read()).toMatchObject({ noticeDialog: false, billingDialog: false });
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

  it('blocks start while a usage notice or a billing dialog shows, with the same message', () => {
    for (const s of [{ ...idle, noticeDialog: true }, { ...idle, billingDialog: true }]) {
      expect(checkCanStart(s, 'unscripted4ce@gmail.com')).toEqual({
        ok: false,
        reason: 'policy-dialog',
        message: 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Start again.',
      });
    }
  });

  it('names Resume when asked to, keeping the wording otherwise', () => {
    expect(checkCanStart({ ...idle, signedInEmail: 'someone@example.com' }, 'unscripted4ce@gmail.com', 'Resume')).toEqual({
      ok: false,
      reason: 'wrong-account',
      message:
        'Flow is signed in to someone@example.com, but VidFlow is set to use unscripted4ce@gmail.com. Switch Flow to unscripted4ce@gmail.com, then press Resume.',
    });
    for (const s of [{ ...idle, signedInEmail: null }, { ...idle, noticeDialog: true }, { ...idle, billingDialog: true }, { ...idle, ready: false }]) {
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
  it('reads the live grid: one flow-grid-tile-container per picture, icon text left out of captions', () => {
    // Live Flow (5 Nov 2026): the scroll wrapper has ONE row div holding every tile container.
    const tile = (inner: string) =>
      `<flow-grid-tile-container class="mat-context-menu-trigger"><div>${inner}<div><mat-icon aria-hidden="true">image</mat-icon><span>${'{c}'}</span></div></div></flow-grid-tile-container>`;
    const done = (id: string, caption: string) =>
      tile(`<img data-media-id="${id}" src="https://flow-content.google/image/${id}">`).replace('{c}', caption);
    const pending = (pct: string, caption: string) => tile(`<div>${pct}</div>`).replace('{c}', caption);
    document.body.innerHTML = `<div class="cdk-virtual-scroll-content-wrapper"><div class="virtual-scroll-container"><div>
      ${pending('26%', 'The hero waves')}${done('id-a', 'Hero pointing at bill lines')}${done('id-b', 'Hero reading bill')}
    </div></div><div></div></div>`;
    const cards = createFlowDriver().resultCards();
    expect(cards.map((c) => c.key)).toEqual(['pending-0', 'id-a', 'id-b']);
    expect(cards[0]).toMatchObject({ caption: 'The hero waves', progress: 26, imageUrl: null });
    expect(cards[1]).toMatchObject({ caption: 'Hero pointing at bill lines', progress: null, domIndex: 1 });
  });

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

const REFERENCE = 'vidflow-hero-3f1c2a9e.png';
const ATTACH_MESSAGE = "VidFlow couldn't attach the hero reference in Flow. Check the Flow window, then press Resume.";

/** jsdom has no DataTransfer: a stand-in whose files are the File objects added to it. */
class FakeDataTransfer {
  private list: File[] = [];
  items = { add: (f: File) => void this.list.push(f) };
  get files() {
    return this.list as unknown as FileList;
  }
}

/**
 * Stand-in for Flow's ingredients picker, behaving as spike S7 recorded it: the trigger opens the picker in the overlay;
 * "Upload media" appends an input[type=file] to <body> and clicks it; a change shows "Uploading <name>", then
 * "<name> Image" plus a grid tile with its own media id; option → "Add to prompt" puts one Ingredient chip in the bar.
 */
function fakePicker(
  opts: {
    uploadMs?: number;
    neverFinishes?: boolean;
    addsChip?: boolean;
    /** Flow makes a new input for this upload and puts it first in <body> (not reusing one already there). */
    freshInputFirst?: boolean;
    ignoresEscape?: boolean;
    /** Flow fills the asset list this long after the picker opens. */
    assetsLoadMs?: number;
    /** A brand-new Flow project: the picker shows "No assets found." and has no asset list until something is uploaded. */
    emptyProject?: boolean;
    /** Flow clicks its file input again once the upload is under way (after the file was set, before the picker closes). */
    clicksAgain?: boolean;
  } = {},
) {
  vi.stubGlobal('DataTransfer', FakeDataTransfer);
  const overlay = document.createElement('div');
  overlay.className = 'cdk-overlay-container';
  document.body.append(overlay);
  const uploaded: File[] = [];
  const fileClicks: boolean[] = []; // whether each click on the file input was allowed to open the file window
  let selected: string | null = null;
  const assets: string[] = []; // names VidFlow uploaded, kept across picker openings like Flow's project assets
  const uploading = new Set<string>();

  function render() {
    let list = overlay.querySelector('[role="listbox"]');
    if (!list && opts.emptyProject && assets.length > 0 && overlay.querySelector('.upload-media')) {
      overlay.querySelector('.no-assets')?.remove();
      list = document.createElement('div');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Asset list');
      overlay.firstElementChild!.prepend(list);
    }
    if (!list) return;
    list.querySelectorAll('[data-uploaded]').forEach((o) => o.remove());
    for (const name of assets) {
      const o = document.createElement('button');
      o.setAttribute('role', 'option');
      o.dataset.uploaded = '';
      o.innerHTML = uploading.has(name)
        ? `<span class="asset-name">Uploading</span><span class="asset-type">${name}</span>`
        : `<span class="asset-name">${name}</span><span class="asset-type">Image</span>`;
      o.addEventListener('click', () => (selected = name));
      list.prepend(o);
    }
  }

  // Live Flow (5 Nov 2026): Escape closes the picker only when it comes from inside the overlay, not from the document.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !opts.ignoresEscape && e.target instanceof Node && overlay.contains(e.target)) overlay.innerHTML = '';
  });

  function open() {
    overlay.innerHTML = fixture('ingredients-picker.html');
    selected = null;
    if (opts.emptyProject && assets.length === 0) {
      const list = overlay.querySelector('[role="listbox"]')!;
      list.insertAdjacentHTML('afterend', '<div class="no-assets">No assets found.</div>');
      list.remove();
    } else if (opts.assetsLoadMs) {
      const list = overlay.querySelector('[role="listbox"]')!;
      const loaded = list.innerHTML;
      list.innerHTML = '';
      setTimeout(() => {
        list.innerHTML = loaded;
        render();
      }, opts.assetsLoadMs);
    } else render();
    overlay.querySelector('.upload-media')!.addEventListener('click', () => {
      let input = opts.freshInputFirst ? null : document.querySelector<HTMLInputElement>('body > input[type="file"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        let files: FileList | null = null;
        Object.defineProperty(input, 'files', { get: () => files, set: (v: FileList) => void (files = v) });
        input.addEventListener('click', (e) => fileClicks.push(!e.defaultPrevented));
        input.addEventListener('change', () => {
          const file = (input!.files as unknown as File[])[0]!;
          uploaded.push(file);
          assets.push(file.name);
          uploading.add(file.name);
          render();
          if (opts.clicksAgain) setTimeout(() => input!.click(), 0);
          if (opts.neverFinishes) return;
          setTimeout(() => {
            uploading.delete(file.name);
            render();
            document.body.insertAdjacentHTML(
              'beforeend',
              `<flow-grid-tile-container><div>${file.name}</div><img data-media-id="ref-media-1" src="https://flow-content.google/ref"></flow-grid-tile-container>`,
            );
          }, opts.uploadMs ?? 10);
        });
        if (opts.freshInputFirst) document.body.prepend(input);
        else document.body.append(input);
      }
      input.click();
    });
    overlay.querySelector('.add-to-prompt')!.addEventListener('click', () => {
      if (!selected) return;
      overlay.innerHTML = '';
      if (opts.addsChip === false) return;
      $(SEL.promptBar).insertAdjacentHTML(
        'beforeend',
        '<button class="chip-container" aria-label="Ingredient"><img class="chip-image" alt="Ingredient image"></button>',
      );
    });
  }

  $(SEL.ingredients).addEventListener('click', () => (overlay.querySelector('.upload-media') ? (overlay.innerHTML = '') : open()));
  return { uploaded, fileClicks, assets, chips: () => document.querySelectorAll(SEL.ingredientChip).length };
}

describe('FlowDriver hero reference', () => {
  afterEach(() => vi.unstubAllGlobals());
  const driver = () => createFlowDriver(document, { pollMs: 5, timeoutMs: 300 });
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], REFERENCE, { type: 'image/png' });

  it('uploads into a brand-new Flow project whose picker says "No assets found."', async () => {
    // Live Flow (5 Nov 2026): a fresh project's picker has no asset list at all until the first upload.
    load('prompt-bar.html');
    const picker = fakePicker({ emptyProject: true });
    await expect(driver().uploadReference(png())).resolves.toBe('ref-media-1');
    expect(picker.uploaded.map((f) => f.name)).toEqual([REFERENCE]);
    expect(picker.fileClicks).toEqual([false]);
    expect(document.querySelector('.cdk-overlay-container')!.innerHTML).toBe(''); // the picker was closed
  });

  it('uploads the reference through the picker without opening the file window, and reads its tile media id', async () => {
    load('prompt-bar.html');
    const picker = fakePicker();
    await expect(driver().uploadReference(png())).resolves.toBe('ref-media-1');
    expect(picker.uploaded.map((f) => f.name)).toEqual([REFERENCE]);
    expect(picker.uploaded[0]!.type).toBe('image/png');
    expect(picker.fileClicks).toEqual([false]); // the Mac file window never opens
  });

  it('closes the picker after the upload, and carries on when it stays open', async () => {
    load('prompt-bar.html');
    fakePicker();
    await driver().uploadReference(png());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    document.body.innerHTML = '';
    load('prompt-bar.html');
    fakePicker({ ignoresEscape: true });
    await expect(driver().uploadReference(png())).resolves.toBe('ref-media-1');
  });

  it('sets the file on the input Flow clicked, never on another file input in the page', async () => {
    load('prompt-bar.html');
    const stale = document.createElement('input');
    stale.type = 'file';
    const staleSets = vi.fn();
    Object.defineProperty(stale, 'files', { get: () => null, set: staleSets });
    const picker = fakePicker({ freshInputFirst: true });
    document.body.append(stale); // e.g. left by an earlier upload, after Flow's new one in <body>
    await driver().uploadReference(png());
    expect(staleSets).not.toHaveBeenCalled();
    expect(picker.uploaded.map((f) => f.name)).toEqual([REFERENCE]);
  });

  it("waits for the asset list to load before deciding it isn't uploaded yet", async () => {
    load('prompt-bar.html');
    const picker = fakePicker({ assetsLoadMs: 40 });
    const d = driver();
    await d.uploadReference(png());
    document.querySelector('.cdk-overlay-container')!.innerHTML = ''; // the picker closed
    await d.uploadReference(png()); // the reopened list is empty for a moment
    expect(picker.uploaded).toHaveLength(1);
  });

  it('attaches the reference through the picker', async () => {
    load('prompt-bar.html');
    const picker = fakePicker();
    const d = driver();
    await d.uploadReference(png());
    await d.attachReference(REFERENCE);
    expect(picker.chips()).toBe(1);
    expect(d.hasReference()).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull(); // Add to prompt closed the picker
  });

  const NOTICE_HTML =
    '<div role="dialog" class="notice"><p>Confirm you have the necessary rights to upload this media.</p><button>I agree</button></div>';

  it('a usage notice mid-upload stops the upload as a notice', async () => {
    load('prompt-bar.html');
    fakePicker({ neverFinishes: true });
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', NOTICE_HTML), 20);
    const err = await driver().uploadReference(png()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).notice).toBe(true);
    expect((err as FlowBlockedError).event).toEqual({ type: 'needsOwner', reason: 'policy-dialog', message: 'Flow is showing a message about its usage policy or billing. Read it in the Flow window, then press Resume.' });
  });

  it('a notice while the asset list loads stops at once, before anything is uploaded', async () => {
    load('prompt-bar.html');
    const picker = fakePicker({ assetsLoadMs: 1_000 });
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', NOTICE_HTML), 20);
    const started = Date.now();
    const err = await createFlowDriver(document, { pollMs: 5, timeoutMs: 3_000 }).uploadReference(png()).catch((e: unknown) => e);
    expect((err as FlowBlockedError).notice).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
    expect(picker.uploaded).toEqual([]);
  });

  it('a notice while waiting for the uploaded tile stops as a notice instead of answering no tile', async () => {
    load('prompt-bar.html');
    fakePicker();
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 3_000 });
    const tiles = () => document.querySelectorAll('flow-grid-tile-container');
    const observer = new MutationObserver(() => {
      // As soon as the picker closes after the upload, hide the tile and show a notice.
      if (!document.querySelector('[role="listbox"]') && !document.querySelector('.notice')) {
        tiles().forEach((t) => t.remove());
        document.body.insertAdjacentHTML('beforeend', NOTICE_HTML);
      }
    });
    const upload = d.uploadReference(png()).catch((e: unknown) => e);
    await tick(1);
    observer.observe(document.body, { subtree: true, childList: true });
    const err = await upload;
    observer.disconnect();
    expect((err as FlowBlockedError).notice).toBe(true);
  });

  it('a usage notice blocks attaching the reference as a notice; a billing dialog never counts as one', async () => {
    load('prompt-bar.html');
    fakePicker();
    document.body.insertAdjacentHTML('beforeend', NOTICE_HTML);
    const notice = await driver().attachReference(REFERENCE).catch((e: unknown) => e);
    expect((notice as FlowBlockedError).notice).toBe(true);
    document.body.insertAdjacentHTML('beforeend', fixture('billing-dialog.html'));
    const billing = await driver().attachReference(REFERENCE).catch((e: unknown) => e);
    expect(billing).toBeInstanceOf(FlowBlockedError);
    expect((billing as FlowBlockedError).notice).toBe(false);
  });

  it("doesn't upload twice when it's already in the project's assets", async () => {
    load('prompt-bar.html');
    const picker = fakePicker();
    const d = driver();
    await d.uploadReference(png());
    await d.attachReference(REFERENCE);
    await d.uploadReference(png()); // e.g. a retry after the page reloaded mid-upload
    expect(picker.uploaded).toHaveLength(1);
    expect(picker.assets).toEqual([REFERENCE]);
  });

  it('re-attaching clears a chip left in the bar, so exactly one ingredient remains', async () => {
    load('prompt-bar.html');
    const picker = fakePicker();
    const d = driver();
    await d.uploadReference(png());
    await d.attachReference(REFERENCE);
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    $(SEL.clearPrompt).addEventListener('click', () => document.querySelectorAll(SEL.ingredientChip).forEach((c) => c.remove()));
    await d.attachReference(REFERENCE);
    expect(picker.chips()).toBe(1);
    expect(picker.uploaded).toHaveLength(1);
  });

  it('throws a FlowBlockedError when the picker isn\'t found', async () => {
    load('prompt-bar.html');
    $(SEL.ingredients).remove();
    const err = await driver().attachReference(REFERENCE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).event).toEqual({ type: 'needsOwner', reason: 'page-not-recognised', message: ATTACH_MESSAGE });
    await expect(driver().uploadReference(png())).rejects.toBeInstanceOf(FlowBlockedError);
  });

  it('pauses when the upload never finishes', async () => {
    load('prompt-bar.html');
    fakePicker({ neverFinishes: true });
    const err = await driver().uploadReference(png()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(ATTACH_MESSAGE);
  });

  it('pauses when Add to prompt leaves no chip', async () => {
    load('prompt-bar.html');
    const d = driver();
    fakePicker({ addsChip: false });
    await d.uploadReference(png());
    await expect(d.attachReference(REFERENCE)).rejects.toBeInstanceOf(FlowBlockedError);
  });

  it('keeps the file window shut until the picker has closed, then lets file inputs be', async () => {
    load('prompt-bar.html');
    const picker = fakePicker({ clicksAgain: true, uploadMs: 30 });
    await driver().uploadReference(png());
    expect(picker.fileClicks).toEqual([false, false]); // the late click was cancelled too
    // Afterwards the page's own file inputs work again.
    const later = document.querySelector<HTMLInputElement>('body > input[type="file"]')!;
    later.click();
    expect(picker.fileClicks).toEqual([false, false, true]);
  });

  it('lets file inputs be after an upload that fails', async () => {
    load('prompt-bar.html');
    const picker = fakePicker({ neverFinishes: true });
    await expect(driver().uploadReference(png())).rejects.toBeInstanceOf(FlowBlockedError);
    document.querySelector<HTMLInputElement>('body > input[type="file"]')!.click();
    expect(picker.fileClicks).toEqual([false, true]);
  });

  it('clears an Ingredient left in the bar before typing a prompt that uses no reference', async () => {
    load('prompt-bar.html');
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button class="chip-container" aria-label="Ingredient"></button>');
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    const cleared = vi.fn(() => document.querySelectorAll(SEL.ingredientChip).forEach((c) => c.remove()));
    $(SEL.clearPrompt).addEventListener('click', cleared);
    await expect(driver().prepareSubmit('A stickman waves')).resolves.toEqual({ x: 5, y: 5 });
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(SEL.ingredientChip)).toHaveLength(0);
    expect($(SEL.promptBox).textContent).toBe('A stickman waves');
  });

  it("won't answer ready for a prompt with an unmentioned Ingredient it can't clear", async () => {
    load('prompt-bar.html');
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button class="chip-container" aria-label="Ingredient"></button>');
    // No Clear prompt button.
    let err = await driver().prepareSubmit('A stickman waves').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(STRAY_INGREDIENT_MESSAGE);
    // A Clear prompt that leaves the chip.
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    err = await driver().prepareSubmit('A stickman waves').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(STRAY_INGREDIENT_MESSAGE);
  });

  it('never answers ready for a prompt that needs the reference when the chip is gone', async () => {
    load('prompt-bar.html');
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
    const err = await driver().prepareSubmit('Match the reference', { reference: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(ATTACH_MESSAGE);
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button class="chip-container" aria-label="Ingredient"></button>');
    await expect(driver().prepareSubmit('Match the reference', { reference: true })).resolves.toEqual({ x: 5, y: 5 });
  });
});

describe('FlowDriver Agent mode', () => {
  it('turns Agent mode off before typing, and never turns it on', async () => {
    load('prompt-bar.html');
    const chip = $('.agent-mode-chip');
    const clicks = vi.fn(() => chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
    chip.addEventListener('click', clicks);
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 200 });
    await d.turnOffAgentMode();
    expect(clicks).not.toHaveBeenCalled(); // already off: left alone
    chip.setAttribute('aria-pressed', 'true');
    await d.turnOffAgentMode();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it("pauses when Agent mode won't turn off", async () => {
    load('prompt-bar.html');
    $('.agent-mode-chip').setAttribute('aria-pressed', 'true');
    const err = await createFlowDriver(document, { pollMs: 5, timeoutMs: 100 }).turnOffAgentMode().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toMatch(/Agent/);
  });
});

describe('FlowDriver.acceptNotice', () => {
  it('acceptNotice ticks the box and clicks I agree', async () => {
    load('prompt-bar.html', 'usage-notice.html');
    const box = $<HTMLInputElement>('#rights');
    const agree = $<HTMLButtonElement>('button.agree');
    const cancel = $<HTMLButtonElement>('button.cancel');
    // Flow enables "I agree" once the box is ticked; pressing it closes the notice.
    box.addEventListener('change', () => (agree.disabled = !box.checked));
    const agreed = vi.fn(() => $('mat-dialog-container').remove());
    agree.addEventListener('click', agreed);
    const cancelled = vi.fn();
    cancel.addEventListener('click', cancelled);

    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 200 }).acceptNotice()).toBe(true);
    expect(box.checked).toBe(true);
    expect(agreed).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    expect(createFlowDriver().read().noticeDialog).toBe(false);
  });

  it('accepts an "I understand" notice without a checkbox', async () => {
    load('prompt-bar.html');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><p>You must have the necessary rights to upload this media.</p><button>I understand</button></div>',
    );
    const understood = vi.fn();
    document.querySelector('[role="dialog"] button')!.addEventListener('click', understood);
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(true);
    expect(understood).toHaveBeenCalledTimes(1);
  });

  it('never presses anything in a billing or upgrade dialog', async () => {
    load('prompt-bar.html', 'billing-dialog.html');
    const pressed = vi.fn();
    document.querySelectorAll('[role="dialog"] button').forEach((b) => b.addEventListener('click', pressed));
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(false);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('never accepts a refusal-style dialog that only offers OK or Edit prompt', async () => {
    load('prompt-bar.html');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><p>This prompt may violate our usage policy.</p><button>OK</button><button>Edit prompt</button><button>Confirm</button></div>',
    );
    const pressed = vi.fn();
    document.querySelectorAll('[role="dialog"] button').forEach((b) => b.addEventListener('click', pressed));
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(false);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('only matches the whole accept label, and not a broad "rights to" mention', async () => {
    load('prompt-bar.html');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><p>Prohibited Use Policy</p><button>I agree to pay</button><button>Accept all cookies and upgrades later</button></div>',
    );
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(false);
    document.body.innerHTML = '';
    load('prompt-bar.html');
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><p>You have the rights to edit this project.</p><button>Continue</button></div>');
    expect(createFlowDriver().read().noticeDialog).toBe(false);
  });

  it('ticks a native checkbox inside a role=checkbox wrapper once, without toggling the wrapper again', async () => {
    load('prompt-bar.html');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><p>Prohibited Use Policy</p><div role="checkbox" aria-checked="false" class="wrap"><input type="checkbox" /></div><button>I agree</button></div>',
    );
    const wrap = $('.wrap');
    const box = wrap.querySelector('input')!;
    box.addEventListener('change', () => wrap.setAttribute('aria-checked', String(box.checked)));
    const wrapperClicks = vi.fn();
    wrap.addEventListener('click', (e) => e.target === wrap && wrapperClicks());
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(true);
    expect(box.checked).toBe(true);
    expect(wrapperClicks).not.toHaveBeenCalled();
  });

  it('answers false when there is no notice, or it has no accept button', async () => {
    load('prompt-bar.html');
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><p>Prohibited Use Policy</p><button>Read more</button></div>');
    expect(await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).acceptNotice()).toBe(false);
  });
});

describe('tile helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('find a picture by its media id and the tile around it', () => {
    document.body.innerHTML = `<flow-grid-tile-container><div><img data-media-id="k1"></div></flow-grid-tile-container>`;
    const img = tileImage(document, 'k1')!;
    expect(img.dataset.mediaId).toBe('k1');
    expect(tileContainer(img).tagName).toBe('FLOW-GRID-TILE-CONTAINER');
    expect(tileImage(document, 'k1"], body, [x="')).toBeNull(); // the key is compared, never put in a selector
  });

  it('fall back to the tile list child (fixture layout)', () => {
    load('tiles.html');
    const img = tileImage(document, '4ca91b00-de41-44e5-ab6c-85c484c751ab')!;
    expect(tileContainer(img).classList.contains('tile')).toBe(true);
  });
});

describe('FlowDriver checks (read only)', () => {
  it("reads model, aspect and outputs from the settings button's own text", () => {
    load('prompt-bar.html');
    expect(createFlowDriver().readSettings()).toEqual({ model: 'Nano Banana 2.1', aspect: '9:16', outputs: 2 });
    document.body.innerHTML = '';
    expect(createFlowDriver().readSettings()).toEqual({ model: null, aspect: null, outputs: null });
  });

  it('reads a credit balance only when the page shows one, never the "will use 0 credits" note', () => {
    load('prompt-bar.html');
    const driver = createFlowDriver();
    expect(driver.readCredits()).toBeNull();
    document.querySelector('header')!.insertAdjacentHTML('beforeend', '<span>1,250 credits left</span>');
    expect(driver.readCredits()).toBe(1250);
  });

  it('reads when the credits reset, only when the page shows it', () => {
    load('prompt-bar.html');
    const driver = createFlowDriver();
    expect(driver.readCreditsResets()).toBeNull();
    document.querySelector('header')!.insertAdjacentHTML('beforeend', '<span>1,250 credits left</span><span>Resets on 13 Nov</span>');
    expect(driver.readCreditsResets()).toBe('13 Nov');
    document.querySelector('header')!.lastElementChild!.textContent = '(resets 1 Dec)';
    expect(driver.readCreditsResets()).toBe('1 Dec');
  });

  it('says whether Agent mode is on', () => {
    load('prompt-bar.html');
    const driver = createFlowDriver();
    expect(driver.agentModeOn()).toBe(false);
    $('.agent-mode-chip').setAttribute('aria-pressed', 'true');
    expect(driver.agentModeOn()).toBe(true);
  });

  it('clears the prompt with Flow’s Clear prompt button', async () => {
    load('prompt-bar.html');
    $(SEL.promptBox).innerHTML = '<p>VidFlow test — this will be cleared</p>';
    const clear = vi.fn(() => ($(SEL.promptBox).innerHTML = '<p><br></p>'));
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    $(SEL.clearPrompt).addEventListener('click', clear);
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 100 }).clearPrompt()).resolves.toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

// ---- Plan 3: clips (spike S8) and Agent questions (spikes S6/S7) ----------------------------------------------

/** Stand-in for Flow's video settings radios (live .toggle-text markup): a click checks it and updates the trigger. */
function fakeVideoRadios() {
  const icons: Record<string, string> = { '16:9': 'crop_16_9', '9:16': 'crop_9_16' };
  const clicked: string[] = [];
  document.querySelectorAll<HTMLElement>('[role="radio"]').forEach((radio) =>
    radio.addEventListener('click', () => {
      const label = radio.querySelector('.toggle-text')!.textContent!.trim();
      clicked.push(label);
      radio.parentElement!.querySelectorAll('[role="radio"]').forEach((r) => r.setAttribute('aria-checked', 'false'));
      radio.setAttribute('aria-checked', 'true');
      const trigger = $(SEL.settingsTrigger);
      if (icons[label]) trigger.innerHTML = trigger.innerHTML.replace(/crop_(16_9|9_16)/, icons[label]);
      if (/^x\d$/.test(label)) trigger.innerHTML = trigger.innerHTML.replace(/x\d/, label);
      if (/^\d+s$/.test(label)) trigger.innerHTML = trigger.innerHTML.replace(/\b\d+s\b/, label);
      if (/^\d+p$/.test(label)) trigger.innerHTML = trigger.innerHTML.replace(/\b\d+p\b/, label);
    }),
  );
  return clicked;
}

const START_FRAME = 'vidflow-s01.png';
const START_MESSAGE = "VidFlow couldn't attach the start picture in Flow. Check the Flow window, then press Resume.";
const startChip = () => document.querySelector(SEL.startFrameChip);
const emptyChip = (label: string) =>
  [...document.querySelectorAll('button.empty-chip')].find((b) => b.textContent!.includes(label)) ?? null;

/**
 * Stand-in for Flow's "Select a frame image" picker (spike S8): the Start empty-chip opens it; Upload media works as in
 * S7; clicking an asset attaches it to Start at once (no "Add to prompt") and closes the overlay.
 */
function fakeFramePicker(opts: { emptyProject?: boolean; attaches?: boolean; neverFinishes?: boolean } = {}) {
  vi.stubGlobal('DataTransfer', FakeDataTransfer);
  const overlay = document.createElement('div');
  overlay.className = 'cdk-overlay-container';
  document.body.append(overlay);
  const uploaded: File[] = [];
  const fileClicks: boolean[] = [];
  const assets: string[] = [];
  const uploading = new Set<string>();
  const startClicks = vi.fn();

  function render() {
    const list = overlay.querySelector('.frame-assets');
    if (!list) return;
    list.querySelectorAll('[data-uploaded]').forEach((o) => o.remove());
    for (const name of assets) {
      const o = document.createElement('button');
      o.setAttribute('role', 'option');
      o.dataset.uploaded = '';
      o.innerHTML = uploading.has(name) ? `<span>Uploading</span><span>${name}</span>` : `<mat-icon>image</mat-icon><span>${name}</span>`;
      o.addEventListener('click', () => {
        overlay.innerHTML = '';
        if (opts.attaches === false) return;
        emptyChip('Start')!.outerHTML =
          '<button class="chip-container" aria-label="Image ingredient"><img class="chip-image cropped" alt="Ingredient image"></button>';
      });
      list.prepend(o);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target instanceof Node && overlay.contains(e.target)) overlay.innerHTML = '';
  });
  function open() {
    overlay.innerHTML = fixture('frame-picker.html');
    if (opts.emptyProject && assets.length === 0) {
      overlay.querySelector('.frame-assets')!.innerHTML = '<div class="no-assets">No assets found.</div>';
    }
    render();
    overlay.querySelector('.upload-media')!.addEventListener('click', () => {
      let input = document.querySelector<HTMLInputElement>('body > input[type="file"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        let files: FileList | null = null;
        Object.defineProperty(input, 'files', { get: () => files, set: (v: FileList) => void (files = v) });
        input.addEventListener('click', (e) => fileClicks.push(!e.defaultPrevented));
        input.addEventListener('change', () => {
          const file = (input!.files as unknown as File[])[0]!;
          uploaded.push(file);
          assets.push(file.name);
          uploading.add(file.name);
          overlay.querySelector('.no-assets')?.remove();
          render();
          if (opts.neverFinishes) return;
          setTimeout(() => {
            uploading.delete(file.name);
            render();
          }, 10);
        });
        document.body.append(input);
      }
      input.click();
    });
  }
  emptyChip('Start')!.addEventListener('click', () => {
    startClicks();
    open();
  });
  return { uploaded, fileClicks, assets, startClicks };
}

describe('FlowDriver video settings (spike S8)', () => {
  const driver = () => createFlowDriver(document, { pollMs: 5, timeoutMs: 200 });

  it('each setter clicks the right radio', async () => {
    load('video-prompt-bar.html');
    $('[role="radio"]').setAttribute('aria-checked', 'true'); // Image on, Video off
    [...document.querySelectorAll('[role="radio"]')][1]!.setAttribute('aria-checked', 'false');
    $(SEL.settingsTrigger).innerHTML = 'Video · 360p · 4s<br>crop_16_9<br>x2';
    const radios = [...document.querySelectorAll('[role="radio"]')];
    radios.find((r) => r.textContent === '360p')!.setAttribute('aria-checked', 'true');
    radios.find((r) => r.textContent === '720p')!.setAttribute('aria-checked', 'false');
    const clicked = fakeVideoRadios();
    const d = driver();
    await d.setVideoMode();
    await d.setFramesMode();
    await d.setResolution720();
    await d.setClipLength(8);
    await d.setAspect('9:16');
    await d.setOutputs(1);
    expect(clicked).toEqual(['Video', 'Frames', '720p', '8s', '9:16', 'x1']);
    expect($(SEL.settingsTrigger).textContent).toContain('8s');
    expect($(SEL.settingsTrigger).textContent).toContain('720p');
  });

  it('leaves a setting that is already right alone', async () => {
    load('video-prompt-bar.html');
    const clicked = fakeVideoRadios();
    const d = driver();
    await d.setVideoMode();
    await d.setResolution720();
    await d.setClipLength(4);
    expect(clicked).toEqual([]);
  });

  it('sets 10 s without mistaking it for another length', async () => {
    load('video-prompt-bar.html');
    const clicked = fakeVideoRadios();
    await driver().setClipLength(10);
    expect(clicked).toEqual(['10s']);
    await driver().setClipLength(6);
    expect(clicked).toEqual(['10s', '6s']);
  });

  it('fails when a length does not take', async () => {
    load('video-prompt-bar.html'); // no fake radios
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).setClipLength(6)).rejects.toThrow(/6s/);
  });
});

describe('FlowDriver Generate cost and credit balance (spike S8)', () => {
  it('reads "Generating will use N credits" from the open popover and leaves it open', async () => {
    load('video-prompt-bar.html');
    const trigger = vi.fn();
    $(SEL.settingsTrigger).addEventListener('click', trigger);
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 100 }).readGenerateCost()).resolves.toBe(14);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('opens a closed popover to read the cost, then closes it again', async () => {
    load('video-prompt-bar.html');
    const popover = $('.settings-popover');
    popover.remove();
    $(SEL.settingsTrigger).addEventListener('click', () => {
      if (!document.body.contains(popover)) document.body.append(popover);
      else popover.remove();
    });
    popover.querySelector('.credit-cost-label span')!.textContent = 'Generating will use 7 credits';
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 100 }).readGenerateCost()).resolves.toBe(7);
    expect(document.body.contains(popover)).toBe(false);
  });

  it('gives null when no cost shows', async () => {
    load('prompt-bar.html'); // the picture popover's note has no .credit-cost-label
    $('.settings-popover').remove();
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).readGenerateCost()).resolves.toBeNull();
  });

  /** Account details opens the panel; only its Close account panel button closes it (Escape doesn't). */
  function fakeAccountPanel(text?: { credits?: string; resets?: string }) {
    const close = vi.fn();
    $('[aria-label="Account details"]').addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', fixture('account-panel.html'));
      const panel = document.querySelector('.account-panel')!;
      if (text?.credits !== undefined) panel.querySelector('.credits-link span')!.textContent = text.credits;
      if (text?.resets !== undefined) panel.querySelectorAll(':scope > span')[0]!.textContent = text.resets;
      panel.querySelector('[aria-label="Close account panel"]')!.addEventListener('click', () => {
        close();
        panel.closest('.cdk-overlay-container')!.remove();
      });
    });
    return close;
  }

  it('reads "1,043 Google Flow credits · Resets on 13 Nov at 13:50", then closes the panel', async () => {
    load('prompt-bar.html');
    const close = fakeAccountPanel();
    const balance = await createFlowDriver(document, { pollMs: 5, timeoutMs: 100 }).readCreditBalance();
    expect(balance).toEqual({ credits: 1043, resets: '13 Nov at 13:50' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.account-panel')).toBeNull();
  });

  it('closes the panel also when it cannot read a balance', async () => {
    load('prompt-bar.html');
    const close = fakeAccountPanel({ credits: 'Credits unavailable', resets: '' });
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).readCreditBalance()).resolves.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('says whether the account panel is still open (it is closed after reading)', async () => {
    load('prompt-bar.html');
    fakeAccountPanel();
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 100 });
    await d.readCreditBalance();
    expect(d.accountPanelOpen()).toBe(false);
    load('prompt-bar.html', 'account-panel.html');
    expect(createFlowDriver().accountPanelOpen()).toBe(true);
  });

  it('reads a balance without a reset date', async () => {
    load('prompt-bar.html');
    fakeAccountPanel({ resets: '' });
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).readCreditBalance()).resolves.toEqual({ credits: 1043, resets: null });
  });

  it('gives null off the project grid page (no Account details button)', async () => {
    document.body.innerHTML = fixture('video-detail.html');
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).readCreditBalance()).resolves.toBeNull();
  });

  it('the open account panel is not a billing dialog', () => {
    load('prompt-bar.html', 'account-panel.html');
    expect(createFlowDriver().read()).toMatchObject({ billingDialog: false, noticeDialog: false });
  });

  it('a billing dialog blocks reading the balance and is never clicked', async () => {
    load('prompt-bar.html', 'billing-dialog.html');
    const account = vi.fn();
    $('[aria-label="Account details"]').addEventListener('click', account);
    const pressed = vi.fn();
    document.querySelectorAll('.cdk-overlay-container button').forEach((b) => b.addEventListener('click', pressed));
    const err = await createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).readCreditBalance().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect(account).not.toHaveBeenCalled();
    expect(pressed).not.toHaveBeenCalled();
  });
});

describe('FlowDriver start frame (spike S8)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const driver = () => createFlowDriver(document, { pollMs: 5, timeoutMs: 300 });
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], START_FRAME, { type: 'image/png' });

  it('uploads the start frame through the Start picker without opening the file window, then closes it', async () => {
    load('video-prompt-bar.html');
    const picker = fakeFramePicker();
    await driver().uploadStartFrame(png());
    expect(picker.uploaded.map((f) => f.name)).toEqual([START_FRAME]);
    expect(picker.fileClicks).toEqual([false]);
    expect(document.querySelector('.cdk-overlay-container')!.innerHTML).toBe('');
    expect(startChip()).toBeNull(); // uploading attaches nothing
    // The guard is gone afterwards: the page's own file inputs work again.
    document.querySelector<HTMLInputElement>('body > input[type="file"]')!.click();
    expect(picker.fileClicks).toEqual([false, true]);
  });

  it('uploads into a brand-new project whose picker says "No assets found."', async () => {
    load('video-prompt-bar.html');
    const picker = fakeFramePicker({ emptyProject: true });
    await driver().uploadStartFrame(png());
    expect(picker.uploaded).toHaveLength(1);
  });

  it("doesn't upload twice when the frame is already in the project", async () => {
    load('video-prompt-bar.html');
    const picker = fakeFramePicker();
    await driver().uploadStartFrame(png());
    await driver().uploadStartFrame(png());
    expect(picker.uploaded).toHaveLength(1);
  });

  it('pauses with the start-frame message when the upload never finishes', async () => {
    load('video-prompt-bar.html');
    fakeFramePicker({ neverFinishes: true });
    const err = await driver().uploadStartFrame(png()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(START_MESSAGE);
  });

  it('attaches by name: the Start slot holds the picture and End stays empty', async () => {
    load('video-prompt-bar.html');
    const picker = fakeFramePicker();
    const d = driver();
    await d.uploadStartFrame(png());
    await d.attachStartFrame(START_FRAME);
    expect(startChip()).not.toBeNull();
    expect(emptyChip('End')).not.toBeNull();
    expect(d.hasStartFrame()).toBe(true);
    expect(picker.uploaded).toHaveLength(1);
    expect(document.querySelector('[role="option"]')).toBeNull(); // the overlay closed
  });

  it('clears a start frame left from an earlier try before attaching', async () => {
    load('video-prompt-bar.html');
    fakeFramePicker();
    const d = driver();
    await d.uploadStartFrame(png());
    await d.attachStartFrame(START_FRAME);
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    const cleared = vi.fn(() => {
      startChip()!.outerHTML = '<button type="button" class="empty-chip"><span>Start</span></button>';
      fakeStartAgain();
    });
    const fakeStartAgain = () => {
      emptyChip('Start')!.addEventListener('click', () => {
        document.querySelector('.cdk-overlay-container')!.innerHTML = fixture('frame-picker.html');
        const o = document.querySelector<HTMLElement>('.frame-assets [role="option"]')!;
        o.innerHTML = `<mat-icon>image</mat-icon><span>${START_FRAME}</span>`;
        o.addEventListener('click', () => {
          document.querySelector('.cdk-overlay-container')!.innerHTML = '';
          emptyChip('Start')!.outerHTML = '<button class="chip-container" aria-label="Image ingredient"></button>';
        });
      });
    };
    $(SEL.clearPrompt).addEventListener('click', cleared);
    await d.attachStartFrame(START_FRAME);
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(SEL.startFrameChip)).toHaveLength(1);
  });

  it('pauses when picking the frame leaves Start empty', async () => {
    load('video-prompt-bar.html');
    fakeFramePicker({ attaches: false });
    const d = driver();
    await d.uploadStartFrame(png());
    const err = await d.attachStartFrame(START_FRAME).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(START_MESSAGE);
  });

  it('pauses when the page has no Start slot (not in Frames mode)', async () => {
    load('prompt-bar.html');
    const err = await driver().attachStartFrame(START_FRAME).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(START_MESSAGE);
  });

  it('never answers ready for a clip prompt without its start frame', async () => {
    load('video-prompt-bar.html');
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
    const err = await driver().prepareSubmit('The stickman waves', { startFrame: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(START_MESSAGE);
    emptyChip('Start')!.outerHTML = '<button class="chip-container" aria-label="Image ingredient"></button>';
    await expect(driver().prepareSubmit('The stickman waves', { startFrame: true })).resolves.toEqual({ x: 5, y: 5 });
  });

  it('a billing dialog blocks attaching and is never clicked', async () => {
    load('video-prompt-bar.html');
    const picker = fakeFramePicker();
    document.body.insertAdjacentHTML('beforeend', fixture('billing-dialog.html'));
    const pressed = vi.fn();
    document.querySelectorAll('mat-dialog-container button').forEach((b) => b.addEventListener('click', pressed));
    const err = await driver().attachStartFrame(START_FRAME).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).notice).toBe(false);
    expect(picker.startClicks).not.toHaveBeenCalled();
    expect(pressed).not.toHaveBeenCalled();
  });
});

describe('FlowDriver video tiles and clip detail (spike S8)', () => {
  it('lists drawing, finished and uploaded tiles in grid order, without media ids on videos', () => {
    load('video-tiles.html');
    expect(createFlowDriver().videoResultCards()).toEqual([
      { key: 'pending-0', caption: 'The stickman waves hello', imageUrl: null, progress: 42, refusal: null, domIndex: 0 },
      {
        key: 'video-1',
        caption: 'Stickman with red cap waving',
        imageUrl: 'https://flow.google.com/asb/AbC123token',
        progress: null,
        refusal: null,
        domIndex: 1,
        video: true,
      },
      {
        key: 'frame-media-1',
        caption: 'vidflow-s01.png',
        imageUrl: 'https://flow-content.google/image/frame-media-1',
        progress: null,
        refusal: null,
        domIndex: 2,
      },
    ]);
  });

  it('reports a refused clip', () => {
    document.body.innerHTML =
      '<flow-grid-tile-container><div>The stickman waves</div><div>This prompt might violate our policies.</div></flow-grid-tile-container>';
    expect(createFlowDriver().videoResultCards()[0]).toMatchObject({ refusal: 'This prompt might violate our policies.', progress: null });
  });

  it("reads the clip's prompt and edit id from its page", () => {
    load('video-detail.html');
    history.pushState({}, '', '/u/0/project/p-123/edit/edit-456');
    expect(createFlowDriver().readVideoDetail()).toEqual({
      prompt: 'The stickman waves hello. Keep the exact same drawing style and characters as the start frame.',
      editId: 'edit-456',
      // The media rail's vidflow-sNN.png names are the project's uploads, not this clip's start frame (which has none).
      startFrame: null,
    });
    history.pushState({}, '', '/u/0/project/p-123');
    expect(createFlowDriver().readVideoDetail().editId).toBeNull();
  });

  /** Download media opens the menu; "720p Original size" makes Flow fetch the signed file URL (a resource entry). */
  function fakeDownload(opts: { fetches?: boolean } = {}) {
    let now = 1_000;
    const entries: Array<{ name: string; startTime: number }> = [
      { name: 'https://flow-content.google/video/old-clip?Expires=1&Signature=x', startTime: 10 },
    ];
    const chosen: string[] = [];
    $('[aria-label="Download media"]').addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', fixture('download-menu.html'));
      document.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach((item) =>
        item.addEventListener('click', () => {
          chosen.push(item.textContent!.replace(/\s+/g, ' ').trim());
          document.querySelector('[role="menu"]')!.parentElement!.remove();
          if (opts.fetches === false) return;
          setTimeout(() => {
            entries.push({ name: 'https://flow.google.com/asb/preview=mm,22,15', startTime: now + 5 });
            entries.push({ name: 'https://flow-content.google/video/1fc37838-aa?Expires=9&KeyName=k&Signature=s', startTime: now + 10 });
          }, 10);
        }),
      );
    });
    const perf = { now: () => now, getEntriesByType: (t: string) => (t === 'resource' ? [...entries] : []) };
    return { perf, chosen, tick: () => (now += 1) };
  }

  it("presses Download media, chooses 720p Original size and returns the clip's signed URL and media id", async () => {
    load('video-detail.html');
    const dl = fakeDownload();
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 200, perf: dl.perf as never });
    await expect(d.clipFileUrl(300)).resolves.toEqual({
      url: 'https://flow-content.google/video/1fc37838-aa?Expires=9&KeyName=k&Signature=s',
      mediaId: '1fc37838-aa',
    });
    expect(dl.chosen).toEqual(['movie720pOriginal size']); // never GIF, 1080p or 4K
  });

  it('never returns an older clip URL; null after the timeout', async () => {
    load('video-detail.html');
    const dl = fakeDownload({ fetches: false });
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 100, perf: dl.perf as never });
    await expect(d.clipFileUrl(60)).resolves.toBeNull();
  });

  it('gives null without a Download media button or a 720p choice', async () => {
    document.body.innerHTML = '<div></div>';
    await expect(createFlowDriver(document, { pollMs: 5, timeoutMs: 50 }).clipFileUrl(50)).resolves.toBeNull();
    load('video-detail.html');
    $('[aria-label="Download media"]').addEventListener('click', () =>
      document.body.insertAdjacentHTML('beforeend', '<div role="menu"><button role="menuitem">1080p Upscaled</button></div>'),
    );
    const upscaled = vi.fn();
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 50 });
    const pending = d.clipFileUrl(50);
    await tick(1);
    document.querySelector('[role="menuitem"]')!.addEventListener('click', upscaled);
    await expect(pending).resolves.toBeNull();
    expect(upscaled).not.toHaveBeenCalled();
  });
});

describe('FlowDriver Agent questions (spike S8, Agent panel recorded live)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const QUESTION = 'Image 1 is the first attachment, image 2 the second. Which shows the shoulder bag? Answer 1 or 2.';
  const imageChips = () => document.querySelectorAll('button.chip-container[aria-label="Image ingredient"]');

  /**
   * Agent mode as recorded (spike S8): the chip toggles aria-pressed; the first send opens flow-agent-panel and moves
   * the prompt bar into it; pictures are attached with the S7 picker and show as "Image ingredient" chips; Start new
   * session empties the conversation; Close removes the panel. `send()` stands in for the background's trusted press.
   */
  function fakeAgent(names: string[]) {
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const overlay = document.createElement('div');
    overlay.className = 'cdk-overlay-container';
    document.body.append(overlay);
    const attached: string[] = [];
    const chip = $('.agent-mode-chip');
    chip.addEventListener('click', () => chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
    const triggers: string[] = []; // where each picker opening came from
    $(SEL.ingredients).addEventListener('click', (e) => {
      triggers.push((e.currentTarget as Element).closest('flow-agent-panel') ? 'panel' : 'page');
      overlay.innerHTML = fixture('ingredients-picker.html');
      const list = overlay.querySelector('[role="listbox"]')!;
      let selected: string | null = null;
      for (const name of names.filter((n) => !attached.includes(n))) {
        const o = document.createElement('button');
        o.setAttribute('role', 'option');
        o.innerHTML = `<span>${name}</span><span>Image</span>`;
        o.addEventListener('click', () => (selected = name));
        list.prepend(o);
      }
      overlay.querySelector('.add-to-prompt')!.addEventListener('click', () => {
        if (!selected) return;
        attached.push(selected);
        overlay.innerHTML = '';
        $(SEL.promptBar).insertAdjacentHTML(
          'beforeend',
          '<button class="chip-container" aria-label="Image ingredient"><img class="chip-image" alt="Ingredient image"></button>',
        );
      });
    });
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button aria-label="Clear prompt">close</button>');
    const clears = vi.fn(() => imageChips().forEach((c) => c.remove()));
    $(SEL.clearPrompt).addEventListener('click', clears);
    const closes = vi.fn();
    const newSessions = vi.fn();
    const list = () => $('.messages-list');
    function openPanel() {
      document.body.insertAdjacentHTML('beforeend', fixture('agent-panel.html'));
      $('.agent-prompt-bar').append($(SEL.promptBar)); // the prompt bar moves into the panel
      $('[aria-label="Close"]').addEventListener('click', () => {
        closes();
        document.body.prepend($(SEL.promptBar));
        document.querySelector('flow-agent-panel')!.remove();
      });
      $('[aria-label="Start new session"]').addEventListener('click', () => {
        newSessions();
        list().innerHTML = '';
      });
    }
    /** The background's press on send: the question row, then (after a moment) the Agent's row. */
    function send(reply: string | null) {
      if (!document.querySelector('flow-agent-panel')) openPanel();
      imageChips().forEach((c) => c.remove()); // sending clears the attached pictures
      list().insertAdjacentHTML('beforeend', `<div class="message-row user-row"><span class="structured-prompt-text">${QUESTION}</span></div>`);
      if (reply === null) return;
      setTimeout(() => {
        list().insertAdjacentHTML(
          'beforeend',
          `<div class="message-row agent-row"><flow-chat-bubble><div class="agent-bubble"><button>Show thinking</button><div class="agent-message-content"><flow-a2ui-message-renderer><flow-markdown-content><div class="markdown-container"></div></flow-markdown-content></flow-a2ui-message-renderer></div><button aria-label="Good response">thumb_up</button><button aria-label="Copy">content_copy</button></div></flow-chat-bubble></div>`,
        );
        setTimeout(() => {
          list().lastElementChild!.querySelector('.markdown-container')!.innerHTML = `<p>${reply}</p>`;
        }, 15);
      }, 15);
    }
    return { attached, chip, send, closes, newSessions, clears, triggers, openPanel, list };
  }

  const ready = () => {
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 100, top: 600, width: 20, height: 20 }) as DOMRect;
  };
  const driver = () => createFlowDriver(document, { pollMs: 5, timeoutMs: 300, settleMs: 30 });

  it('turns Agent mode on, attaches the pictures in order, types the question and answers with where send is', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['vidflow-s01-a.png', 'vidflow-s01-b.png']);
    const at = await driver().prepareAgentQuestion(['vidflow-s01-b.png', 'vidflow-s01-a.png'], QUESTION);
    expect(at).toEqual({ x: 110, y: 610 });
    expect(agent.chip.getAttribute('aria-pressed')).toBe('true');
    expect(agent.attached).toEqual(['vidflow-s01-b.png', 'vidflow-s01-a.png']);
    expect(imageChips()).toHaveLength(2);
    expect($(SEL.promptBox).textContent).toBe(QUESTION);
  });

  it('returns the new agent row\'s answer, and finishing closes the panel and turns Agent mode off', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png']);
    const d = driver();
    await d.prepareAgentQuestion(['a.png', 'b.png'], QUESTION);
    agent.send('2 — she wears a shoulder bag across her body');
    await expect(d.readAgentReply(1_000)).resolves.toBe('2 — she wears a shoulder bag across her body');
    await expect(d.finishAgent()).resolves.toBe(true);
    expect(agent.closes).toHaveBeenCalledTimes(1);
    expect(agent.chip.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('flow-agent-panel')).toBeNull();
  });

  it('starts a new session in an open panel, attaches through its own Add ingredients, after clearing a leftover picture', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png', 'c.png', 'd.png']);
    const d = driver();
    await d.prepareAgentQuestion(['a.png', 'b.png'], QUESTION);
    agent.send('1');
    await d.readAgentReply(1_000);
    // A picture left in the panel's prompt bar, e.g. from a question that never went.
    $(SEL.promptBar).insertAdjacentHTML('beforeend', '<button class="chip-container" aria-label="Image ingredient"></button>');
    // A stale Add ingredients button left in the page outside the panel must not be used.
    document.body.insertAdjacentHTML('afterbegin', '<button aria-label="Add ingredients to the prompt box" class="stale">add</button>');
    const stale = vi.fn();
    $('.stale').addEventListener('click', stale);
    agent.triggers.length = 0;
    $(SEL.promptBox).innerHTML = '<p><br></p>';
    await d.prepareAgentQuestion(['c.png', 'd.png'], QUESTION);
    expect(agent.newSessions).toHaveBeenCalledTimes(1);
    expect(agent.list().children).toHaveLength(0); // fresh context
    expect(agent.clears).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    expect(agent.triggers).toEqual(['panel', 'panel']);
    expect(agent.attached.slice(2)).toEqual(['c.png', 'd.png']);
    expect(imageChips()).toHaveLength(2);
  });

  it('never takes its own question, an empty answer or an earlier row for the reply', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png']);
    agent.openPanel();
    agent.list().innerHTML =
      '<div class="message-row agent-row"><div class="markdown-container"><p>An old answer</p></div></div>';
    $('[aria-label="Start new session"]').replaceWith(document.createElement('span')); // no new session: old row stays
    const d = driver();
    await d.prepareAgentQuestion(['a.png', 'b.png'], QUESTION);
    agent.list().insertAdjacentHTML('beforeend', `<div class="message-row user-row"><span class="structured-prompt-text">${QUESTION}</span></div>`);
    agent.list().insertAdjacentHTML('beforeend', '<div class="message-row agent-row"><div class="markdown-container"></div></div>');
    await expect(d.readAgentReply(80)).resolves.toBeNull();
  });

  it('gives null on a timeout (the background still finishes)', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png']);
    const d = driver();
    await d.prepareAgentQuestion(['a.png', 'b.png'], QUESTION);
    agent.send(null);
    await expect(d.readAgentReply(60)).resolves.toBeNull();
    await d.finishAgent();
    expect(agent.chip.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('flow-agent-panel')).toBeNull();
  });

  it('gives null without a question asked first (e.g. after the page reloaded)', async () => {
    load('prompt-bar.html');
    await expect(driver().readAgentReply(50)).resolves.toBeNull();
  });

  it('turns Agent mode off again when preparing fails', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png']); // b.png isn't in the project
    const err = await driver().prepareAgentQuestion(['a.png', 'b.png'], QUESTION).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect(agent.chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('a billing dialog blocks the question, is never clicked, and Agent mode stays off', async () => {
    load('prompt-bar.html', 'billing-dialog.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png']);
    const pressed = vi.fn();
    document.querySelectorAll('mat-dialog-container button').forEach((b) => b.addEventListener('click', pressed));
    const err = await driver().prepareAgentQuestion(['a.png', 'b.png'], QUESTION).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as FlowBlockedError).notice).toBe(false);
    expect(pressed).not.toHaveBeenCalled();
    expect(agent.chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('a usage notice while waiting for the reply stops as a notice', async () => {
    load('prompt-bar.html');
    ready();
    const agent = fakeAgent(['a.png', 'b.png']);
    const d = driver();
    await d.prepareAgentQuestion(['a.png', 'b.png'], QUESTION);
    agent.send(null);
    document.body.insertAdjacentHTML('beforeend', fixture('usage-notice.html'));
    const err = await d.readAgentReply(500).catch((e: unknown) => e);
    expect((err as FlowBlockedError).notice).toBe(true);
  });
});

describe("FlowDriver Flow's announcements (spike S8)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const announce = () => {
    document.body.insertAdjacentHTML('beforeend', fixture('announcement.html'));
    const getStarted = vi.fn(() => document.querySelector('.announcement')!.closest('.cdk-overlay-container')!.remove());
    const changelogs = vi.fn();
    $('.get-started').addEventListener('click', getStarted);
    $('.changelogs').addEventListener('click', changelogs);
    return { getStarted, changelogs };
  };

  it('reads an announcement as its own kind: not a notice, not billing', () => {
    load('prompt-bar.html');
    announce();
    expect(createFlowDriver().read()).toMatchObject({ announcement: true, noticeDialog: false, billingDialog: false });
  });

  it('closes it with Get started (never View all changelogs) and counts it', () => {
    load('prompt-bar.html');
    const a = announce();
    const d = createFlowDriver();
    expect(d.dismissAnnouncement()).toBe(true);
    expect(a.getStarted).toHaveBeenCalledTimes(1);
    expect(a.changelogs).not.toHaveBeenCalled();
    expect(d.announcementsClosed()).toBe(1);
    expect(d.dismissAnnouncement()).toBe(false);
    expect(d.read().announcement).toBe(false);
  });

  it('a billing dialog with a Get started button is never taken for one', () => {
    load('prompt-bar.html', 'billing-dialog.html');
    $('mat-dialog-container').insertAdjacentHTML('beforeend', '<button>Get started</button>');
    const d = createFlowDriver();
    expect(d.dismissAnnouncement()).toBe(false);
    expect(d.read()).toMatchObject({ announcement: false, billingDialog: true });
  });

  it('an announcement appearing mid-upload is closed and the upload carries on', async () => {
    load('prompt-bar.html');
    const picker = fakePicker({ uploadMs: 40 });
    const a = { getStarted: vi.fn() };
    setTimeout(() => {
      const shown = announce();
      shown.getStarted.mockImplementation(() => {
        a.getStarted();
        document.querySelector('.announcement')!.closest('.cdk-overlay-container')!.remove();
      });
    }, 10);
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 300 });
    await expect(d.uploadReference(new File([new Uint8Array([1])], REFERENCE, { type: 'image/png' }))).resolves.toBe('ref-media-1');
    expect(picker.uploaded).toHaveLength(1);
    expect(a.getStarted).toHaveBeenCalledTimes(1);
    expect(d.announcementsClosed()).toBe(1);
  });

  it('is closed before a clip start frame is attached', async () => {
    load('video-prompt-bar.html');
    fakeFramePicker();
    const a = announce();
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 300 });
    await d.uploadStartFrame(new File([new Uint8Array([1])], START_FRAME, { type: 'image/png' }));
    await d.attachStartFrame(START_FRAME);
    expect(a.getStarted).toHaveBeenCalledTimes(1);
    expect(d.hasStartFrame()).toBe(true);
  });
});

describe('FlowDriver review fixes (round 2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says whether a question is waiting for its reply (none after a reload)', () => {
    load('prompt-bar.html');
    expect(createFlowDriver().agentQuestionPending()).toBe(false);
  });

  it('an answer that starts with "Working…" or "Generating…" counts once it has settled', async () => {
    load('prompt-bar.html');
    fakeEditor();
    $(SEL.generate).removeAttribute('disabled');
    $(SEL.generate).getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect;
    $('.agent-mode-chip').addEventListener('click', () => $('.agent-mode-chip').setAttribute('aria-pressed', 'true'));
    document.body.insertAdjacentHTML('beforeend', fixture('agent-panel.html'));
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 300, settleMs: 30 });
    await d.prepareAgentQuestion([], 'Which one?');
    expect(d.agentQuestionPending()).toBe(true);
    $('.messages-list').insertAdjacentHTML(
      'beforeend',
      '<div class="message-row agent-row"><div class="markdown-container"><p>Working through both: 2 has the bag</p></div></div>',
    );
    await expect(d.readAgentReply(500)).resolves.toBe('Working through both: 2 has the bag');
  });

  it('closes the ingredients picker before opening the Start frame picker', async () => {
    load('video-prompt-bar.html');
    const frames = fakeFramePicker();
    // The ingredients picker is open (e.g. left from an Agent question): its Upload media must not be used.
    const overlay = document.querySelector('.cdk-overlay-container')!;
    overlay.innerHTML = fixture('ingredients-picker.html');
    const wrongUpload = vi.fn();
    overlay.querySelector('.upload-media')!.addEventListener('click', wrongUpload);
    const d = createFlowDriver(document, { pollMs: 5, timeoutMs: 300 });
    await d.uploadStartFrame(new File([new Uint8Array([1])], START_FRAME, { type: 'image/png' }));
    expect(wrongUpload).not.toHaveBeenCalled();
    expect(frames.startClicks).toHaveBeenCalledTimes(1);
    expect(frames.uploaded.map((f) => f.name)).toEqual([START_FRAME]);
  });

  it('pauses rather than use a picker that will not close', async () => {
    load('video-prompt-bar.html');
    const frames = fakeFramePicker();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    overlay.innerHTML = fixture('ingredients-picker.html');
    overlay.addEventListener('keydown', (e) => e.stopPropagation()); // Escape never reaches Flow's handler
    const err = await createFlowDriver(document, { pollMs: 5, timeoutMs: 100 })
      .attachStartFrame(START_FRAME)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowBlockedError);
    expect((err as Error).message).toBe(START_MESSAGE);
    expect(frames.startClicks).not.toHaveBeenCalled();
  });
});
