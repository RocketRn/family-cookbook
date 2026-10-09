import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { signInitData } from '../src/telegram/signing';
import { __resetTelegramRuntime, haptic, initTelegram } from '../src/telegram/sdk';

const vector = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../api/test/fixtures/initdata-vector.json'), 'utf8'),
) as {
  botToken: string;
  hash: string;
  initData: string;
  withSignature: { hash: string; initData: string };
};

async function resign(initData: string): Promise<string | null> {
  const fields: Record<string, string> = {};
  new URLSearchParams(initData).forEach((v, k) => {
    if (k !== 'hash') fields[k] = v;
  });
  return new URLSearchParams(await signInitData(fields, vector.botToken)).get('hash');
}

beforeEach(() => {
  __resetTelegramRuntime();
  document.body.innerHTML = '';
});

describe('dev initData signer (browser WebCrypto)', () => {
  it('includes the signature field in the HMAC (matches the Python reference vector)', async () => {
    expect(new URLSearchParams(vector.withSignature.initData).get('signature')).toBeTruthy();
    expect(await resign(vector.withSignature.initData)).toBe(vector.withSignature.hash);
  });

  it('reproduces the Python hmac reference hash for the committed vector', async () => {
    const src = new URLSearchParams(vector.initData);
    const fields: Record<string, string> = {};
    src.forEach((v, k) => {
      if (k !== 'hash') fields[k] = v;
    });
    const signed = await signInitData(fields, vector.botToken);
    expect(new URLSearchParams(signed).get('hash')).toBe(vector.hash);
  });
});

describe('Telegram runtime', () => {
  it('uses the mock provider with fresh, correctly shaped initData when outside Telegram (dev)', async () => {
    window.Telegram = { WebApp: { initData: '' } as never }; // what the real SDK script defines in a browser
    const rt = await initTelegram();
    expect(rt?.mocked).toBe(true);
    const params = new URLSearchParams(rt!.webApp.initData);
    expect(params.get('hash')).toMatch(/^[0-9a-f]{64}$/);
    const ageSeconds = Date.now() / 1000 - Number(params.get('auth_date'));
    expect(ageSeconds).toBeLessThan(5); // freshly signed, never a stale committed string
    expect(JSON.parse(params.get('user')!).id).toBe(100000001);
    expect(params.get('signature')).toBeTruthy(); // mirrors real clients (A-01b)
  });

  it('installs the mock once when initialised concurrently (React StrictMode runs effects twice)', async () => {
    const [a, b] = await Promise.all([initTelegram(), initTelegram()]);
    expect(a).toBe(b);
    expect(document.querySelectorAll('[data-testid=mock-back-button]')).toHaveLength(1);
  });

  it('selects another dev user with ?devUser=2 and forwards ?startapp=', async () => {
    window.history.replaceState({}, '', '/?devUser=2&startapp=join_devinvitecode');
    const rt = await initTelegram();
    expect(rt!.webApp.initDataUnsafe.user?.id).toBe(100000002);
    expect(rt!.webApp.initDataUnsafe.start_param).toBe('join_devinvitecode');
    expect(new URLSearchParams(rt!.webApp.initData).get('start_param')).toBe('join_devinvitecode');
  });

  it('mocks the SDK surface the app uses', async () => {
    const { webApp } = (await initTelegram())!;
    const clicks: string[] = [];
    const back = () => clicks.push('back');
    webApp.BackButton.onClick(back);
    webApp.BackButton.show();
    const el = document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!;
    expect(el.style.display).toBe('block');
    el.click();
    expect(clicks).toEqual(['back']);
    webApp.BackButton.offClick(back);
    webApp.BackButton.hide();
    expect(el.style.display).toBe('none');

    let granted: boolean | undefined;
    webApp.requestWriteAccess((g) => (granted = g));
    expect(granted).toBe(true);
    let sent: boolean | undefined;
    webApp.shareMessage('id', (s) => (sent = s));
    expect(sent).toBe(true);
    expect(webApp.themeParams.bg_color).toBeTruthy();
    expect(webApp.MainButton.isVisible).toBe(false);
    expect(() => haptic('success')).not.toThrow();
    expect(document.documentElement.dataset.tgScheme).toMatch(/light|dark/);
  });

  it('prefers the real SDK when Telegram supplies initData', async () => {
    const real = {
      initData: 'query_id=x&hash=y',
      initDataUnsafe: {},
      version: '8.0',
      colorScheme: 'dark',
      themeParams: {},
      ready: () => undefined,
      expand: () => undefined,
      isVersionAtLeast: () => false,
      onEvent: () => undefined,
      offEvent: () => undefined,
    };
    window.Telegram = { WebApp: real as never };
    const rt = await initTelegram();
    expect(rt?.mocked).toBe(false);
    expect(rt?.webApp).toBe(real);
    expect(document.querySelector('[data-testid=mock-back-button]')).toBeNull();
  });
});
