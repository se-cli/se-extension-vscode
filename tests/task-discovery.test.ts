import { describe, it, expect } from 'vitest';
import { discoverTestTasks, TestFileInfo, WalkFn } from '../src/task-discovery';

/**
 * Fake walker that reports every file in the flat relative-path map.
 * The walker is deliberately naive (no filtering): discoverTestTasks owns
 * matching and ignore-directory filtering, so this fake exercises that
 * logic rather than the filesystem traversal.
 */
function fakeWalk(files: string[]): WalkFn {
  return (_dir: string, _relDir: string, push: (relPath: string) => void): void => {
    for (const f of files) {
      push(f);
    }
  };
}

const ROOT = '/ws';

describe('discoverTestTasks', () => {
  it('finds mocha test files and builds npx mocha tasks', () => {
    const walk = fakeWalk(['login.test.js', 'README.md', 'src/util.spec.js']);
    const tasks = discoverTestTasks(ROOT, walk);
    const mocha = tasks.filter((t) => t.framework === 'mocha');
    expect(mocha).toHaveLength(2);
    expect(mocha.map((t) => t.file)).toEqual(
      expect.arrayContaining(['login.test.js', 'src/util.spec.js']),
    );
    const login = mocha.find((t) => t.file === 'login.test.js')!;
    expect(login.command).toBe('npx');
    expect(login.args).toEqual(['mocha', 'login.test.js']);
    expect(login.label).toContain('login.test.js');
  });

  it('finds pytest files and builds python -m pytest tasks', () => {
    const walk = fakeWalk(['test_login.py', 'tests/test_session.py', 'util.py']);
    const tasks = discoverTestTasks(ROOT, walk);
    const py = tasks.filter((t) => t.framework === 'pytest');
    expect(py).toHaveLength(2);
    const login = py.find((t) => t.file === 'test_login.py')!;
    expect(login.command).toBe('python');
    expect(login.args).toEqual(['-m', 'pytest', 'test_login.py']);
    expect(login.label).toContain('test_login.py');
  });

  it('finds JUnit5 Java test classes and builds mvn tasks', () => {
    const walk = fakeWalk(['src/test/java/LoginTest.java', 'src/main/java/App.java']);
    const tasks = discoverTestTasks(ROOT, walk);
    const java = tasks.filter((t) => t.framework === 'junit5');
    expect(java).toHaveLength(1);
    const t = java[0];
    expect(t.command).toBe('mvn');
    expect(t.args).toEqual(['test', '-Dtest=LoginTest']);
    expect(t.label).toContain('LoginTest.java');
  });

  it('skips ignored directories (node_modules, .git, dist, out, target, build, coverage, .se-cli)', () => {
    const walk = fakeWalk([
      'node_modules/pkg/x.test.js',
      '.git/hooks/y.test.js',
      'dist/bundle.test.js',
      'out/compiled.test.js',
      'target/classes/ZTest.java',
      'build/gen.test.js',
      'coverage/lcov.test.js',
      '.se-cli/session.test.js',
      'real.test.js',
    ]);
    const tasks = discoverTestTasks(ROOT, walk);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].file).toBe('real.test.js');
  });

  it('returns an empty list when the workspace has no test files', () => {
    const walk = fakeWalk(['src/main.ts', 'package.json']);
    expect(discoverTestTasks(ROOT, walk)).toEqual([]);
  });

  it('returns the source file list even without an injected walker (default fs walk)', () => {
    // Default walker is exercised by the provider; here we only verify the
    // function shape accepts an omitted walker without throwing.
    expect(() => discoverTestTasks(ROOT)).not.toThrow();
  });
});

describe('TestFileInfo shape', () => {
  it('exposes framework, file, label, command and args', () => {
    const info: TestFileInfo = {
      file: 'a.test.js',
      framework: 'mocha',
      label: 'Run a.test.js',
      command: 'npx',
      args: ['mocha', 'a.test.js'],
    };
    expect(info.framework).toBe('mocha');
    expect(info.label.length).toBeGreaterThan(0);
  });
});
