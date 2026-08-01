/**
 * SeCliWebviewProvider — renders the se-cli browser panel.
 *
 * The panel shows:
 *   - Quick action buttons (open, navigate, snapshot, screenshot, click, fill)
 *   - The last aria snapshot as a scrollable tree
 *   - The last screenshot as an image
 *   - A short command history
 *
 * Communication is via postMessage: the webview sends action requests, and the
 * extension pushes snapshot/screenshot/history updates back.
 */

import * as vscode from 'vscode';

export interface HistoryEntry {
  command: string;
  ok: boolean;
  detail?: string;
  at: number;
}

export class SeCliWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'se-cli.panel';

  private view?: vscode.WebviewView;
  private lastSnapshot = '';
  private lastScreenshot = '';
  private history: HistoryEntry[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: { command: string }) => {
        switch (message.command) {
          case 'openBrowser':
            void vscode.commands.executeCommand('se-cli.openBrowser');
            break;
          case 'closeBrowser':
            void vscode.commands.executeCommand('se-cli.closeBrowser');
            break;
          case 'navigate':
            void vscode.commands.executeCommand('se-cli.navigate');
            break;
          case 'snapshot':
            void vscode.commands.executeCommand('se-cli.snapshot');
            break;
          case 'screenshot':
            void vscode.commands.executeCommand('se-cli.screenshot');
            break;
          case 'click':
            void vscode.commands.executeCommand('se-cli.click');
            break;
          case 'fill':
            void vscode.commands.executeCommand('se-cli.fill');
            break;
          case 'runCommand':
            void vscode.commands.executeCommand('se-cli.runCommand');
            break;
          default:
            break;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // Re-render any state captured before the view resolved.
    this.pushSnapshot(this.lastSnapshot, false);
    this.pushScreenshot(this.lastScreenshot, false);
  }

  /** Reveal and focus the panel. */
  show(): void {
    if (this.view) {
      this.view.show?.(true);
    } else {
      void vscode.commands.executeCommand('workbench.view.extension.se-cli-sidebar');
    }
  }

  /** Update the snapshot view. Pass empty string to clear. */
  updateSnapshot(text: string): void {
    this.lastSnapshot = text;
    this.pushSnapshot(text, true);
  }

  /** Update the screenshot view with a base64 string (no data: prefix). */
  updateScreenshot(base64: string): void {
    this.lastScreenshot = base64;
    this.pushScreenshot(base64, true);
  }

  /** Append an entry to the command history. */
  addHistory(entry: HistoryEntry): void {
    this.history.unshift(entry);
    if (this.history.length > 20) {
      this.history.pop();
    }
    this.postMessage({ type: 'history', entries: this.history });
  }

  /** Show an error banner in the panel. */
  showError(text: string): void {
    this.postMessage({ type: 'error', text });
  }

  /** Update the status line in the panel. */
  setStatus(text: string): void {
    this.postMessage({ type: 'status', text });
  }

  private pushSnapshot(text: string, broadcast: boolean): void {
    if (!broadcast && !text) {
      return;
    }
    this.postMessage({ type: 'snapshot', text });
  }

  private pushScreenshot(base64: string, broadcast: boolean): void {
    if (!broadcast && !base64) {
      return;
    }
    this.postMessage({ type: 'screenshot', src: base64 ? `data:image/png;base64,${base64}` : '' });
  }

  private postMessage(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'se-cli.svg'))
      .toString();

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>se-cli Browser Panel</title>
  <link rel="icon" href="${styleUri}" />
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 10px;
    }
    .toolbar button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      font: inherit;
    }
    .toolbar button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .toolbar button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .toolbar button.danger {
      background-color: var(--vscode-errorForeground, #f14c4c);
      color: #fff;
      border-color: var(--vscode-inputValidation-errorBorder, transparent);
    }
    .toolbar button.danger:hover {
      opacity: 0.85;
    }
    section {
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 8px;
      margin-top: 8px;
    }
    h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h3 .badge {
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
    }
    pre.snapshot {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      padding: 8px;
      border-radius: 4px;
      background-color: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre;
      color: var(--vscode-editor-foreground);
    }
    .screenshot-wrap {
      text-align: center;
    }
    .screenshot-wrap img {
      max-width: 100%;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 0;
    }
    ul.history {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 200px;
      overflow: auto;
    }
    ul.history li {
      padding: 3px 0;
      display: flex;
      gap: 6px;
      align-items: baseline;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    ul.history li .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: 0 0 auto;
      margin-top: 5px;
    }
    ul.history li .dot.ok { background-color: var(--vscode-testing-iconPassed); }
    ul.history li .dot.fail { background-color: var(--vscode-testing-iconFailed); }
    ul.history li .cmd { font-family: var(--vscode-editor-font-family); }
    ul.history li .time { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .error-banner {
      display: none;
      padding: 8px;
      margin-bottom: 8px;
      border-radius: 4px;
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
      font-size: 12px;
    }
    .status {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 4px 0 8px 0;
    }
    a {
      color: var(--vscode-textLink-foreground);
    }
    .copy-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      padding: 0 4px;
    }
    .copy-btn:hover { color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <div id="status" class="status">Daemon: unknown</div>
  <div id="error" class="error-banner"></div>

  <div class="toolbar">
    <button class="primary" id="btn-open">Open Browser</button>
    <button class="danger" id="btn-close">Close</button>
    <button id="btn-navigate">Navigate</button>
    <button id="btn-snapshot">Snapshot</button>
    <button id="btn-screenshot">Screenshot</button>
    <button id="btn-click">Click</button>
    <button id="btn-fill">Fill</button>
    <button id="btn-run" style="grid-column: 1 / -1">Run Command…</button>
  </div>

  <section>
    <h3>Screenshot <span class="badge" id="shot-badge"></span></h3>
    <div class="screenshot-wrap" id="screenshot"><div class="empty">No screenshot yet.</div></div>
  </section>

  <section>
    <h3>Aria Snapshot <button class="copy-btn" id="copy-snapshot">Copy</button></h3>
    <pre class="snapshot" id="snapshot"><span class="empty">No snapshot yet. Run a snapshot to inspect the page.</span></pre>
  </section>

  <section>
    <h3>History</h3>
    <ul class="history" id="history"><li class="empty">No commands run yet.</li></ul>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    const buttons = {
      'btn-open': 'openBrowser',
      'btn-close': 'closeBrowser',
      'btn-navigate': 'navigate',
      'btn-snapshot': 'snapshot',
      'btn-screenshot': 'screenshot',
      'btn-click': 'click',
      'btn-fill': 'fill',
      'btn-run': 'runCommand',
    };
    Object.entries(buttons).forEach(([id, command]) => {
      const el = $(id);
      if (el) { el.addEventListener('click', () => vscode.postMessage({ command })); }
    });

    $('copy-snapshot').addEventListener('click', () => {
      const text = $('snapshot').innerText;
      navigator.clipboard.writeText(text);
    });

    function fmtTime(at) {
      const d = new Date(at);
      return d.toLocaleTimeString();
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'snapshot': {
          const el = $('snapshot');
          if (msg.text) {
            el.textContent = msg.text;
          } else {
            el.innerHTML = '<span class="empty">Snapshot was empty.</span>';
          }
          break;
        }
        case 'screenshot': {
          const el = $('screenshot');
          const badge = $('shot-badge');
          if (msg.src) {
            el.innerHTML = '<img alt="screenshot" src="' + msg.src + '" />';
            if (badge) { badge.textContent = ''; }
          } else {
            el.innerHTML = '<div class="empty">No screenshot yet.</div>';
          }
          break;
        }
        case 'history': {
          const el = $('history');
          if (!msg.entries || msg.entries.length === 0) {
            el.innerHTML = '<li class="empty">No commands run yet.</li>';
            break;
          }
          el.innerHTML = msg.entries.map((e) => {
            const cls = e.ok ? 'ok' : 'fail';
            const detail = e.detail ? ' <span style="opacity:.7">' + escapeHtml(e.detail) + '</span>' : '';
            return '<li><span class="dot ' + cls + '"></span><span class="cmd">' + escapeHtml(e.command) + '</span>' + detail + '<span class="time">' + fmtTime(e.at) + '</span></li>';
          }).join('');
          break;
        }
        case 'error': {
          const el = $('error');
          if (msg.text) {
            el.textContent = msg.text;
            el.style.display = 'block';
          } else {
            el.style.display = 'none';
          }
          break;
        }
        case 'status': {
          $('status').textContent = msg.text;
          break;
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
