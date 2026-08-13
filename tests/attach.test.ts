import { describe, it, expect } from 'vitest';
import {
  buildAttachArgs,
  normalizeCdpUrl,
  probeCdp,
  CdpProbe,
} from '../src/attach';

describe('buildAttachArgs', () => {
  it('builds open --cdp args for a plain URL', () => {
    expect(buildAttachArgs('http://localhost:9222')).toEqual([
      'open',
      '--cdp=http://localhost:9222',
    ]);
  });

  it('includes the browser flag when explicitly configured (not auto)', () => {
    const args = buildAttachArgs('http://localhost:9222', { browser: 'chrome' });
    expect(args).toContain('--browser=chrome');
  });

  it('omits the browser flag for auto', () => {
    const args = buildAttachArgs('http://localhost:9222', { browser: 'auto' });
    expect(args).not.toContain('--browser=auto');
  });

  it('includes the session flag when not default', () => {
    const args = buildAttachArgs('http://localhost:9222', { session: 'demo' });
    expect(args).toEqual(['open', '--cdp=http://localhost:9222', '-s', 'demo']);
  });

  it('omits the session flag for the default session', () => {
    const args = buildAttachArgs('http://localhost:9222', { session: 'default' });
    expect(args).not.toContain('-s');
  });
});

describe('normalizeCdpUrl', () => {
  it('turns a bare port into localhost', () => {
    expect(normalizeCdpUrl('9222')).toBe('http://localhost:9222');
  });

  it('prefixes http:// to host:port', () => {
    expect(normalizeCdpUrl('localhost:9222')).toBe('http://localhost:9222');
    expect(normalizeCdpUrl('127.0.0.1:9333')).toBe('http://127.0.0.1:9333');
  });

  it('keeps complete URLs unchanged', () => {
    expect(normalizeCdpUrl('http://example.com:9222')).toBe('http://example.com:9222');
    expect(normalizeCdpUrl('https://host:9222/')).toBe('https://host:9222/');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCdpUrl('  9222  ')).toBe('http://localhost:9222');
  });
});

describe('probeCdp', () => {
  it('resolves true when the injected probe returns true', async () => {
    const probe: CdpProbe = async () => true;
    await expect(probeCdp('http://localhost:9222', probe)).resolves.toBe(true);
  });

  it('resolves false when the injected probe rejects', async () => {
    const probe: CdpProbe = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(probeCdp('http://localhost:9222', probe)).resolves.toBe(false);
  });
});
