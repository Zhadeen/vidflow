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

  it('fails when the text does not go into the box', async () => {
    load('prompt-bar.html');
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    const driver = createFlowDriver(document, { pollMs: 5, timeoutMs: 50 });
    await expect(driver.prepareSubmit('A stickman waves')).rejects.toThrow(/type/);
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

describe('FlowDriver.attachReference', () => {
  it('says it is not available yet', async () => {
    load('prompt-bar.html');
    await expect(createFlowDriver().attachReference(new Blob(['x']))).rejects.toThrow(/not available yet/);
  });
});
