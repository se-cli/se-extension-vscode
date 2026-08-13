import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the vscode module before importing the provider.
vi.mock('vscode', () => {
  class ProcessExecution {
    constructor(public command: string, public args?: string[]) {}
  }
  return {
    TaskScope: { Workspace: 1, Global: 2 },
    Task: class Task {
      definition: unknown;
      scope: number;
      name: string;
      source: string;
      execution: ProcessExecution;
      constructor(definition: unknown, scope: number, name: string, source: string, execution: ProcessExecution) {
        this.definition = definition;
        this.scope = scope;
        this.name = name;
        this.source = source;
        this.execution = execution;
      }
    },
    ProcessExecution,
  };
});

// Mock discovery results so the provider test focuses on Task wrapping.
vi.mock('../src/task-discovery', () => ({
  discoverTestTasks: vi.fn().mockReturnValue([
    {
      file: 'tests/test_login.py',
      framework: 'pytest',
      label: 'Run tests/test_login.py',
      command: 'python',
      args: ['-m', 'pytest', 'tests/test_login.py'],
    },
    {
      file: 'login.test.js',
      framework: 'mocha',
      label: 'Run login.test.js',
      command: 'npx',
      args: ['mocha', 'login.test.js'],
    },
  ]),
}));

import * as vscode from 'vscode';
import { SeCliTaskProvider } from '../src/task-provider';
import { discoverTestTasks } from '../src/task-discovery';

const mockDiscover = discoverTestTasks as unknown as ReturnType<typeof vi.fn>;

describe('SeCliTaskProvider', () => {
  let provider: SeCliTaskProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SeCliTaskProvider('/ws');
  });

  it('provides one vscode.Task per discovered test file', async () => {
    const tasks = await provider.provideTasks();
    expect(tasks).toHaveLength(2);
    expect(mockDiscover).toHaveBeenCalledWith('/ws');
  });

  it('wraps pytest specs in a ProcessExecution task', async () => {
    const tasks = await provider.provideTasks();
    const py = tasks.find((t) => t.name === 'Run tests/test_login.py')!;
    expect(py).toBeDefined();
    expect(py.source).toBe('se-cli');
    expect(py.definition).toMatchObject({ type: 'se-cli', framework: 'pytest' });
    const exec = py.execution as vscode.ProcessExecution;
    expect(exec.command).toBe('python');
    expect(exec.args).toEqual(['-m', 'pytest', 'tests/test_login.py']);
  });

  it('wraps mocha specs in a ProcessExecution task', async () => {
    const tasks = await provider.provideTasks();
    const mocha = tasks.find((t) => t.name === 'Run login.test.js')!;
    expect(mocha).toBeDefined();
    const exec = mocha.execution as vscode.ProcessExecution;
    expect(exec.command).toBe('npx');
    expect(exec.args).toEqual(['mocha', 'login.test.js']);
  });

  it('resolveTask returns the task unchanged when it has an execution', () => {
    const task = provider.provideTasks().then((tasks) => {
      const resolved = provider.resolveTask(tasks[0]);
      expect(resolved).toBe(tasks[0]);
    });
    return task;
  });

  it('returns an empty task list when nothing is discovered', async () => {
    mockDiscover.mockReturnValueOnce([]);
    const tasks = await provider.provideTasks();
    expect(tasks).toEqual([]);
  });
});
