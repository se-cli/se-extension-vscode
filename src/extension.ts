/**
 * se-extension-vscode — VS Code extension entry point.
 *
 * Wires up se-cli commands, a status bar item showing daemon status, and a
 * webview panel that renders snapshots and screenshots. The se-cli MCP server
 * is declared declaratively via `contributes.mcpServers` in package.json so it
 * is auto-discovered by VS Code's agent/MCP integration.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SeCliRunner, SeCliResult } from './se-cli-runner';
import { SeCliWebviewProvider, HistoryEntry } from './webview-provider';

let runner: SeCliRunner;
let panel: SeCliWebviewProvider;
let statusItem: vscode.StatusBarItem;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  runner = new SeCliRunner(context);
  panel = new SeCliWebviewProvider(context);
  output = vscode.window.createOutputChannel('se-cli');

  // Webview panel in the activity bar sidebar.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SeCliWebviewProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Status bar item.
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'se-cli.runCommand';
  statusItem.tooltip = 'se-cli — click to run a command';
  statusItem.text = '$(browser) se-cli: …';
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(output);

  // ── Commands ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('se-cli.openBrowser', openBrowser),
    vscode.commands.registerCommand('se-cli.closeBrowser', closeBrowser),
    vscode.commands.registerCommand('se-cli.navigate', navigate),
    vscode.commands.registerCommand('se-cli.snapshot', takeSnapshot),
    vscode.commands.registerCommand('se-cli.screenshot', takeScreenshot),
    vscode.commands.registerCommand('se-cli.click', clickElement),
    vscode.commands.registerCommand('se-cli.fill', fillInput),
    vscode.commands.registerCommand('se-cli.showPanel', () => panel.show()),
    vscode.commands.registerCommand('se-cli.runCommand', runCommand),
    vscode.commands.registerCommand('se-cli.checkStatus', checkStatus),
  );

  // Initial status probe.
  void refreshStatus();
}

export function deactivate(): void {
  // The se-cli daemon is an independent process and intentionally outlives the
  // extension. Nothing to tear down here beyond disposed subscriptions.
}

// ─── Configuration helpers ──────────────────────────────────────────────────

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('se-cli');
}

function browser(): string {
  return config().get<string>('browser', 'chrome');
}

function headless(): boolean {
  return config().get<boolean>('headless', true);
}

function autoSnapshot(): boolean {
  return config().get<boolean>('autoSnapshot', true);
}

function workspaceFolder(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

/** Build the args for `se-cli open`. */
function openArgs(url?: string): string[] {
  const args: string[] = ['open'];
  if (url) {
    args.push(url);
  }
  args.push(`--browser=${browser()}`);
  if (!headless()) {
    args.push('--headed');
  }
  args.push(...runner.sessionFlag());
  return args;
}

// ─── Execution helper ───────────────────────────────────────────────────────

interface ExecOptions {
  /** Title shown in the progress notification. */
  title: string;
  /** Whether to show the result text to the user (default: true). */
  notify?: boolean;
  /** Timeout override in ms. */
  timeout?: number;
}

/** Run a se-cli command with a progress indicator, history entry, and error reporting. */
async function exec(args: string[], label: string, opts: ExecOptions): Promise<SeCliResult> {
  panel.show();
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `se-cli: ${opts.title}`,
      cancellable: false,
    },
    () => runner.run(args, { timeout: opts.timeout }),
  );

  const entry: HistoryEntry = {
    command: label,
    ok: result.ok,
    at: Date.now(),
  };

  output.appendLine(`$ se-cli ${args.join(' ')}`);
  if (result.stdout) {
    output.appendLine(result.stdout);
  }
  if (result.stderr) {
    output.appendLine(result.stderr);
  }

  if (!result.ok) {
    const message = (result.stderr || result.stdout || 'Command failed').trim();
    entry.detail = 'failed';
    panel.showError(message);
    if (opts.notify !== false) {
      void vscode.window.showErrorMessage(`se-cli: ${firstLine(message)}`);
    }
  } else {
    panel.showError('');
    if (opts.notify !== false && result.stdout.trim()) {
      void vscode.window.showInformationMessage(`se-cli: ${firstLine(result.stdout.trim())}`);
    }
  }

  panel.addHistory(entry);
  void refreshStatus();
  return result;
}

function firstLine(text: string): string {
  const i = text.indexOf('\n');
  return i === -1 ? text : text.slice(0, i);
}

// ─── Command implementations ────────────────────────────────────────────────

async function openBrowser(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const browserChoice = await vscode.window.showQuickPick(
    [
      { label: 'chrome', description: 'Google Chrome (default)' },
      { label: 'edge', description: 'Microsoft Edge' },
      { label: 'firefox', description: 'Mozilla Firefox' },
    ],
    { placeHolder: 'Select a browser to launch', canPickMany: false },
  );
  if (!browserChoice) {
    return;
  }
  await config().update('browser', browserChoice.label, vscode.ConfigurationTarget.Workspace);
  const url = await vscode.window.showInputBox({
    prompt: 'URL to open (optional — leave empty to start a blank session)',
    placeHolder: 'https://example.com',
  });
  const args = openArgs(url === undefined ? undefined : url);
  // `open` may take a while to start the daemon + driver.
  const result = await exec(args, `open ${browserChoice.label}`, { title: 'Opening browser', timeout: 180_000 });
  if (result.ok && autoSnapshot() && url) {
    await takeSnapshot();
  }
}

async function closeBrowser(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  await exec(['close', ...runner.sessionFlag()], 'close', { title: 'Closing browser' });
}

async function navigate(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt: 'URL to navigate to',
    placeHolder: 'https://example.com',
    validateInput: (v) => (v.trim().length === 0 ? 'URL is required' : null),
  });
  if (!url) {
    return;
  }
  const result = await exec(['goto', url, ...runner.sessionFlag()], `goto ${url}`, { title: 'Navigating' });
  if (result.ok && autoSnapshot()) {
    await takeSnapshot();
  }
}

async function takeSnapshot(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const result = await exec(['snapshot', ...runner.sessionFlag()], 'snapshot', {
    title: 'Taking aria snapshot',
    notify: false,
  });
  if (result.ok) {
    panel.updateSnapshot(result.stdout.trim());
  }
}

async function takeScreenshot(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const result = await exec(['screenshot', ...runner.sessionFlag()], 'screenshot', {
    title: 'Taking screenshot',
    notify: false,
  });
  if (!result.ok) {
    return;
  }
  // se-cli outputs "[Screenshot](.se-cli/<file>)" pointing at the saved PNG.
  const match = result.stdout.match(/\[Screenshot\]\((.+)\)/);
  if (match) {
    const rel = match[1];
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceFolder(), rel);
    try {
      const buf = fs.readFileSync(abs);
      panel.updateScreenshot(buf.toString('base64'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      panel.showError(`Could not read screenshot file: ${msg}`);
    }
  } else {
    // No link parsed — show whatever text was returned.
    panel.updateSnapshot(result.stdout.trim());
  }
}

async function clickElement(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const target = await vscode.window.showInputBox({
    prompt: 'Element ref (e1, e2…) or CSS selector to click',
    placeHolder: 'e1',
    validateInput: (v) => (v.trim().length === 0 ? 'Ref or selector is required' : null),
  });
  if (!target) {
    return;
  }
  await exec(['click', target, ...runner.sessionFlag()], `click ${target}`, { title: 'Clicking element' });
  if (autoSnapshot()) {
    await takeSnapshot();
  }
}

async function fillInput(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const target = await vscode.window.showInputBox({
    prompt: 'Element ref (e1, e2…) or CSS selector of the input',
    placeHolder: 'e1',
    validateInput: (v) => (v.trim().length === 0 ? 'Ref or selector is required' : null),
  });
  if (!target) {
    return;
  }
  const value = await vscode.window.showInputBox({
    prompt: `Text to enter into ${target}`,
    placeHolder: 'value',
    validateInput: (v) => (v.length === 0 ? 'Value is required' : null),
  });
  if (value === undefined) {
    return;
  }
  await exec(['fill', target, value, ...runner.sessionFlag()], `fill ${target}`, { title: 'Filling input' });
  if (autoSnapshot()) {
    await takeSnapshot();
  }
}

interface CommandPickItem extends vscode.QuickPickItem {
  action: string;
}

async function runCommand(): Promise<void> {
  const items: CommandPickItem[] = [
    { label: '$(play) Open Browser', description: 'Start a browser session', action: 'se-cli.openBrowser' },
    { label: '$(debug-stop) Close Browser', description: 'Stop the daemon', action: 'se-cli.closeBrowser' },
    { label: '$(link) Navigate to URL', description: 'Run goto', action: 'se-cli.navigate' },
    { label: '$(eye) Take Aria Snapshot', description: 'Inspect the page', action: 'se-cli.snapshot' },
    { label: '$(camera) Take Screenshot', description: 'Capture the page', action: 'se-cli.screenshot' },
    { label: '$(pointer) Click Element', description: 'Click by ref/selector', action: 'se-cli.click' },
    { label: '$(edit) Fill Input', description: 'Type into an input', action: 'se-cli.fill' },
    { label: '$(pulse) Check Daemon Status', description: 'List active sessions', action: 'se-cli.checkStatus' },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'se-cli — choose a command' });
  if (pick) {
    await vscode.commands.executeCommand(pick.action);
  }
}

async function checkStatus(): Promise<void> {
  if (!(await runner.ensureAvailable())) {
    return;
  }
  const result = await exec(['list'], 'list', { title: 'Checking daemon status', notify: false });
  const text = result.stdout.trim();
  if (text) {
    output.show(true);
  } else {
    void vscode.window.showInformationMessage('se-cli: no active sessions.');
  }
  await refreshStatus();
}

// ─── Status bar ─────────────────────────────────────────────────────────────

/** Probe `se-cli list` and update the status bar to reflect daemon state. */
async function refreshStatus(): Promise<void> {
  if (!runner) {
    return;
  }
  let live = false;
  let browserName = '';
  try {
    const result = await runner.run(['list'], { timeout: 15_000 });
    if (result.ok) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const parts = line.split('\t');
        if (parts.length >= 3 && parts[1] === 'live') {
          live = true;
          browserName = parts[2];
          break;
        }
      }
    }
  } catch {
    // Ignore — keep last known status.
  }
  if (live) {
    statusItem.text = `$(browser) se-cli: ${browserName || 'running'}`;
    statusItem.tooltip = `se-cli daemon is running (${browserName}). Click to run a command.`;
    panel.setStatus(`Daemon: running (${browserName || 'browser'})`);
  } else {
    statusItem.text = '$(circle-slash) se-cli: stopped';
    statusItem.tooltip = 'se-cli daemon is not running. Click to open a browser.';
    panel.setStatus('Daemon: stopped');
  }
}
