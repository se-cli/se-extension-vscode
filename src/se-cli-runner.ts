/**
 * SeCliRunner — executes se-cli commands as child processes.
 *
 * Resolves the se-cli binary in priority order:
 *   1. The user-configured `se-cli.cliPath` setting (if set).
 *   2. A globally installed `se-cli` / `se` / `selenium-cli` binary on PATH.
 *   3. `npx -y @browsers-cli/se-cli` as a fallback (no global install required).
 *
 * All commands are forwarded to the daemon via the se-cli CLI. Output is
 * captured as stdout/stderr and (optionally) parsed as JSON.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';

/** Result of running a se-cli command. */
export interface SeCliResult {
  /** `true` when the process exited with code 0. */
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The process exit code, or `null` if the process failed to spawn. */
  exitCode: number | null;
}

export interface RunOptions {
  /** Timeout in milliseconds (default: 120000). */
  timeout?: number;
  /** When true, stdin is inherited so interactive prompts can be answered. */
  interactive?: boolean;
}

export class SeCliRunner {
  /** Cached availability check so we only probe once per session. */
  private availability: boolean | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('se-cli');
  }

  /** Resolve the executable + leading args used to invoke se-cli. */
  private resolveExecutable(): { command: string; baseArgs: string[] } {
    const cliPath = this.getConfig().get<string>('cliPath', '').trim();
    if (cliPath) {
      return { command: cliPath, baseArgs: [] };
    }
    // npx fallback — works without a global install.
    return { command: 'npx', baseArgs: ['-y', '@browsers-cli/se-cli'] };
  }

  /** The workspace folder cwd to run commands in. */
  private getCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  }

  /**
   * Detect whether se-cli can be invoked. Uses the resolved executable
   * (configured path, global binary, or npx). Cached after the first check.
   */
  async detectCli(): Promise<boolean> {
    if (this.availability !== undefined) {
      return this.availability;
    }
    try {
      // `--help` exits 0 and is the cheapest successful invocation.
      const result = await this.run(['--help'], { timeout: 60_000 });
      this.availability = result.ok || result.exitCode === 0;
    } catch {
      this.availability = false;
    }
    return this.availability;
  }

  /**
   * Ensure se-cli is available, prompting the user to install it if not.
   * Returns true when a command can safely proceed.
   */
  async ensureAvailable(): Promise<boolean> {
    const available = await this.detectCli();
    if (available) {
      return true;
    }
    const choice = await vscode.window.showErrorMessage(
      'se-cli was not found on your system. Install it to enable browser automation, or rely on npx (requires Node.js).',
      'Install via npm',
      'Continue with npx',
    );
    if (choice === 'Install via npm') {
      const term = vscode.window.createTerminal('se-cli install');
      term.show();
      term.sendText('npm install -g @browsers-cli/se-cli');
      const again = await vscode.window.showInformationMessage(
        'Once the install finishes, retry your command.',
        'Got it',
      );
      void again;
      return false;
    }
    if (choice === 'Continue with npx') {
      // Assume npx is available and stop re-checking (it would re-download).
      this.availability = true;
      return true;
    }
    return false;
  }

  /** Run a se-cli command and capture its output. */
  run(args: string[], options?: RunOptions): Promise<SeCliResult> {
    const { command, baseArgs } = this.resolveExecutable();
    const fullArgs = [...baseArgs, ...args];
    const cwd = this.getCwd();
    const timeout = options?.timeout ?? 120_000;

    return new Promise<SeCliResult>((resolve) => {
      const child = spawn(command, fullArgs, {
        shell: true,
        cwd,
        env: process.env,
        stdio: options?.interactive ? ['inherit', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: SeCliResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        finish({ ok: false, stdout, stderr: stderr + '\nTimeout: command exceeded ' + timeout + 'ms', exitCode: null });
      }, timeout);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err: Error) => {
        finish({ ok: false, stdout, stderr: stderr + err.message, exitCode: null });
      });

      child.on('close', (code: number | null) => {
        finish({ ok: code === 0, stdout, stderr, exitCode: code });
      });
    });
  }

  /** Run a command with `--json` and parse the structured output. */
  async runJson<T>(args: string[], options?: RunOptions): Promise<T | null> {
    const result = await this.run([...args, '--json'], options);
    if (!result.ok) {
      return null;
    }
    const text = result.stdout.trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** Build the common `-s <session>` flag from configuration. */
  sessionFlag(): string[] {
    const session = this.getConfig().get<string>('session', 'default');
    return session && session !== 'default' ? ['-s', session] : [];
  }
}
