/**
 * Task discovery for the se-cli VS Code extension.
 *
 * Pure logic (no vscode imports): scans a workspace for test files produced
 * by se-cli's `record export` (mocha / pytest / junit5) and builds the
 * command-line specs used to run them as VS Code tasks. Kept framework-free
 * so it can be unit-tested without an editor host.
 */

import * as fs from 'fs';
import * as path from 'path';

export type TestFramework = 'mocha' | 'pytest' | 'junit5';

/** A discovered test file and the command that runs it. */
export interface TestFileInfo {
  /** Workspace-relative path, posix separators (e.g. "tests/test_login.py"). */
  file: string;
  framework: TestFramework;
  /** Human-readable task label, e.g. "Run tests/test_login.py". */
  label: string;
  /** Executable to spawn (argv[0]). */
  command: string;
  /** Arguments after the executable. */
  args: string[];
}

/** A walker reports every workspace-relative file path (posix separators). */
export type WalkFn = (dir: string, relDir: string, push: (relPath: string) => void) => void;

/** Directories that are never scanned for test files. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'target',
  'build',
  'coverage',
  '.se-cli',
]);

const MOCHA_RE = /\.(test|spec)\.(js|cjs|mjs)$/;
const PYTEST_RE = /^(test_.*|.*_test)\.py$/;
const JUNIT_RE = /Test\.java$/;

/** True when any path segment is an ignored directory. */
function isIgnored(relPath: string): boolean {
  return relPath.split('/').some((seg) => IGNORED_DIRS.has(seg));
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

/** Default walker: recursive fs traversal from the workspace root. */
function defaultWalk(root: string, _relDir: string, push: (relPath: string) => void): void {
  const seen = new Set<string>();

  const visit = (dir: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen.has(entry.name + rel)) {
        continue; // guard against symlink cycles
      }
      const abs = path.join(dir, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        seen.add(entry.name + rel);
        visit(abs, childRel);
      } else if (entry.isFile()) {
        push(childRel);
      }
    }
  };

  visit(root, '');
}

function taskSpec(relPath: string, framework: TestFramework): TestFileInfo | null {
  const file = toPosix(relPath);
  switch (framework) {
    case 'mocha':
      return { file, framework, label: `Run ${file}`, command: 'npx', args: ['mocha', file] };
    case 'pytest':
      return { file, framework, label: `Run ${file}`, command: 'python', args: ['-m', 'pytest', file] };
    case 'junit5': {
      const className = path.basename(file, '.java');
      return { file, framework, label: `Run ${file}`, command: 'mvn', args: ['test', `-Dtest=${className}`] };
    }
  }
}

/** Detect the framework for a test file, or null when it is not a test. */
export function detectFramework(relPath: string): TestFramework | null {
  const base = path.basename(relPath);
  if (MOCHA_RE.test(base)) return 'mocha';
  if (PYTEST_RE.test(base)) return 'pytest';
  if (JUNIT_RE.test(base)) return 'junit5';
  return null;
}

/**
 * Discover runnable test files under `root` and build their task specs.
 * Files under ignored directories are skipped. When `walk` is omitted the
 * default recursive filesystem walker is used.
 */
export function discoverTestTasks(root: string, walk: WalkFn = defaultWalk): TestFileInfo[] {
  const found: TestFileInfo[] = [];
  const push = (relPath: string): void => {
    if (isIgnored(relPath)) {
      return;
    }
    const framework = detectFramework(relPath);
    if (!framework) {
      return;
    }
    const spec = taskSpec(relPath, framework);
    if (spec) {
      found.push(spec);
    }
  };
  walk(root, '', push);
  // Deterministic order for stable task lists.
  found.sort((a, b) => a.file.localeCompare(b.file));
  return found;
}
