/**
 * Attach-to-browser helpers for the se-cli VS Code extension.
 *
 * "Attach to Running Browser" drives `se-cli open --cdp=<url>` so the daemon
 * connects to an already-open Chrome/Edge instance (via debuggerAddress)
 * instead of launching a fresh one. Pure logic lives here (no vscode import)
 * so it can be unit-tested; the extension wires it to a command.
 */

import * as http from 'http';

/** Options controlling the constructed `open --cdp` args. */
export interface AttachOptions {
  /** Browser hint passed through to `open`; omitted for 'auto'. */
  browser?: string;
  /** Named session; omitted for the default session. */
  session?: string;
}

/**
 * Build the argv for `se-cli open --cdp=<url>`. Mirrors the extension's
 * existing openArgs() conventions (browser pinned only when configured,
 * session flag only when non-default).
 */
export function buildAttachArgs(url: string, opts: AttachOptions = {}): string[] {
  const args: string[] = ['open', `--cdp=${url}`];
  if (opts.browser && opts.browser !== 'auto') {
    args.push(`--browser=${opts.browser}`);
  }
  if (opts.session && opts.session !== 'default') {
    args.push('-s', opts.session);
  }
  return args;
}

/**
 * Normalize a user-supplied CDP endpoint:
 *   "9222"            -> "http://localhost:9222"
 *   "localhost:9222"  -> "http://localhost:9222"
 *   "http://host:9222" stays unchanged
 */
export function normalizeCdpUrl(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return `http://localhost:${trimmed}`;
  }
  if (/^[\w.-]+:\d+$/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

/** A probe returns true when a CDP endpoint answers. */
export type CdpProbe = (url: string) => Promise<boolean>;

/** Default probe: GET <url>/json/version with a short timeout. */
export const defaultProbe: CdpProbe = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const target = new URL(url);
    const req = http.get(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: '/json/version',
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });

/** Probe a CDP endpoint, defaulting to the built-in HTTP probe. */
export async function probeCdp(url: string, probe: CdpProbe = defaultProbe): Promise<boolean> {
  try {
    return await probe(url);
  } catch {
    return false;
  }
}
