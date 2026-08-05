# se-cli — Browser Automation for VS Code

A Visual Studio Code extension for [se-cli](https://github.com/se-cli/se-cli), the
token-efficient Selenium browser automation CLI for AI agents and humans.

This extension brings se-cli into VS Code: a sidebar browser panel that renders
aria snapshots and screenshots, a status bar that reflects daemon state, one-click
commands for common browser actions, and automatic registration of the se-cli
**MCP server** so Copilot agents can drive the browser directly.

> Inspired by the [microsoft/playwright-vscode](https://github.com/microsoft/playwright-vscode)
> extension, adapted for se-cli's short-lived CLI + long-lived daemon architecture.

## Features

- **MCP server integration** — se-cli is registered as a Model Context Protocol
  server via `contributes.mcpServers`, exposing all 62 browser automation tools
  (navigate, click, fill, snapshot, screenshot, assertions, network mocking, …)
  to VS Code agents.
- **Browser panel** — a webview in the activity bar showing the last aria
  snapshot as a tree, the last screenshot, quick action buttons, and a command
  history.
- **Status bar** — live daemon status (running browser / stopped). Click to open
  a quick pick of all commands.
- **Commands** — open/close browser, navigate, snapshot, screenshot, click, fill,
  run command, and check daemon status.
- **Auto-snapshot** — optionally take an aria snapshot after every navigation or
  interaction so the panel always reflects the current page.
- **Works with or without a global install** — uses a configured `se-cli` binary,
  a global install on PATH, or falls back to `npx @browsers-cli/se-cli`.

## Requirements

- VS Code 1.103.0 or newer.
- [Node.js](https://nodejs.org/) 18+ (required by se-cli and `npx`).
- se-cli itself is **not** bundled. Install it globally for the best experience:

  ```bash
  npm install -g @browsers-cli/se-cli
  ```

  If se-cli is not found, the extension falls back to
  `npx -y @browsers-cli/se-cli` automatically (the first run may take a moment
  to download the package).

- A supported browser: Google Chrome, Microsoft Edge, or Mozilla Firefox.

## Installation

### From the VS Code Marketplace (coming soon)

Search for "se-cli" in the Extensions view (`Ctrl+Shift+X`).

### From source (development)

```bash
git clone https://github.com/se-cli/se-extension-vscode.git
cd se-extension-vscode
npm install
npm run build
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with
the extension loaded, or package a `.vsix`:

```bash
npm run package      # produces se-extension-vscode-0.1.0.vsix
code --install-extension se-extension-vscode-0.1.0.vsix
```

### From a `.vsix`

```bash
code --install-extension se-extension-vscode-0.1.0.vsix
```

## Usage

1. Open the **se-cli** icon in the activity bar to reveal the browser panel.
2. Run **se-cli: Open Browser** from the command palette or the panel toolbar.
3. Use **se-cli: Navigate to URL**, then **se-cli: Take Aria Snapshot** to inspect
   the page. Element refs (`e1`, `e2`, …) shown in the snapshot can be used with
   **se-cli: Click Element** and **se-cli: Fill Input**.
4. Watch the status bar for daemon state; click it for a quick command menu.

### Snapshots & screenshots

The aria snapshot is a YAML-like accessibility tree annotated with element refs.
Use those refs to target subsequent `click` / `fill` / `hover` commands without
writing CSS selectors. Screenshots are saved to `<workspace>/.se-cli/` and
rendered inline in the panel.

## Configuration

Open Settings and search for `se-cli`, or edit `settings.json` directly.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `se-cli.browser` | `auto` \| `chrome` \| `edge` \| `firefox` | `auto` | Browser to launch when starting a session. `auto` launches the first installed browser (Edge → Chrome → Firefox). |
| `se-cli.headless` | `boolean` | `true` | Run headless. Disable to show the browser window. |
| `se-cli.session` | `string` | `default` | Named session for browser isolation / parallel sessions. |
| `se-cli.autoSnapshot` | `boolean` | `true` | Auto-take an aria snapshot after navigation/interaction. |
| `se-cli.cliPath` | `string` | `""` | Path to the se-cli binary. Empty = auto-detect, then npx fallback. |

Example `settings.json`:

```json
{
  "se-cli.browser": "edge",
  "se-cli.headless": false,
  "se-cli.session": "demo"
}
```

## Commands

| Command | Title | Description |
| --- | --- | --- |
| `se-cli.openBrowser` | se-cli: Open Browser | Pick a browser (or auto-detect) and start a daemon session. |
| `se-cli.closeBrowser` | se-cli: Close Browser | Stop the daemon and close the browser. |
| `se-cli.navigate` | se-cli: Navigate to URL | Run `goto <url>`. |
| `se-cli.snapshot` | se-cli: Take Aria Snapshot | Run `snapshot` and render the tree in the panel. |
| `se-cli.screenshot` | se-cli: Take Screenshot | Run `screenshot` and display the image in the panel. |
| `se-cli.click` | se-cli: Click Element | Click by ref (`e1`) or CSS selector. |
| `se-cli.fill` | se-cli: Fill Input | Fill an input by ref/selector with text. |
| `se-cli.showPanel` | se-cli: Show Browser Panel | Reveal and focus the sidebar panel. |
| `se-cli.runCommand` | se-cli: Run Command | Quick pick of all available commands. |
| `se-cli.checkStatus` | se-cli: Check Daemon Status | Run `list` and show active sessions. |

## MCP server integration

The se-cli MCP server is declared in `package.json` under
`contributes.mcpServers`:

```json
"mcpServers": [
  {
    "label": "se-cli",
    "command": "npx",
    "args": ["-y", "@browsers-cli/se-cli", "mcp-server"],
    "scope": "workspace"
  }
]
```

This exposes every se-cli browser tool to VS Code's agent/MCP integration. You
can also configure it manually in `.vscode/mcp.json`:

```json
{
  "servers": {
    "se-cli": {
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-cli", "mcp-server"]
    }
  }
}
```

See the [se-cli MCP guide](https://github.com/se-cli/se-cli) for the full list of
62 tools (navigation, interaction, assertions, network mocking, storage, tabs,
and more).

## Architecture

```
se-extension-vscode/
├── package.json              # Extension manifest (commands, config, MCP, views)
├── tsconfig.json
├── media/
│   ├── icon.png              # Extension marketplace icon (256x256 PNG)
│   └── se-cli.svg            # Activity bar icon
├── assets/
│   └── img/                  # Logo and branding assets (SVG)
└── src/
    ├── extension.ts          # Entry point: commands, status bar, wiring
    ├── se-cli-runner.ts      # Spawns se-cli / npx, captures output
    └── webview-provider.ts   # Browser panel (snapshots, screenshots, history)
```

The extension is a thin client over the se-cli CLI. Each command spawns
`se-cli <args>` (or `npx -y @browsers-cli/se-cli <args>`), which forwards the
request to the long-lived se-cli daemon that holds the WebDriver instance. The
daemon persists independently of the extension, so closing VS Code does not kill
an active browser session.

```
VS Code ──(spawns)──> se-cli ──(JSON line over socket)──> daemon ──(WebDriver)──> browser
   │                                                           ▲
   └──(MCP over stdio)──> se-cli mcp-server ──────────────────┘
```

## Related

- **se-cli** — https://github.com/se-cli/se-cli
- **se-mcp** — https://github.com/se-cli/se-mcp
- **Homepage** — https://se-cli.github.io/se-site/
- **npm** — https://www.npmjs.com/package/@browsers-cli/se-cli

## License

Apache-2.0. See [LICENSE](./LICENSE).
