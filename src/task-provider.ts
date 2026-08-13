/**
 * SeCliTaskProvider — registers se-cli test files as VS Code tasks.
 *
 * Discovers test files produced by `se-cli record export` in the workspace
 * (mocha / pytest / junit5) and exposes one task per file so they can be run
 * from `Tasks: Run Task`, bound to keybindings, or shared via tasks.json.
 */

import * as vscode from 'vscode';
import { discoverTestTasks, TestFileInfo } from './task-discovery';

export class SeCliTaskProvider implements vscode.TaskProvider {
  /** Task type used in the task definition (`type: "se-cli"`). */
  static readonly TaskType = 'se-cli';

  /** Source label shown in the task list. */
  static readonly Source = 'se-cli';

  constructor(private readonly workspaceRoot: string) {}

  /** Build one vscode.Task from a discovered test spec. */
  private buildTask(info: TestFileInfo): vscode.Task {
    const definition = {
      type: SeCliTaskProvider.TaskType,
      file: info.file,
      framework: info.framework,
    };
    const execution = new vscode.ProcessExecution(info.command, info.args);
    return new vscode.Task(definition, vscode.TaskScope.Workspace, info.label, SeCliTaskProvider.Source, execution);
  }

  /** Provide the current set of runnable test tasks. */
  async provideTasks(): Promise<vscode.Task[]> {
    const specs = discoverTestTasks(this.workspaceRoot);
    return specs.map((info) => this.buildTask(info));
  }

  /** Re-create a task from a persisted definition (Tasks: Rerun etc.). */
  resolveTask(task: vscode.Task): vscode.Task {
    // Tasks created by this provider always carry their own ProcessExecution,
    // so the definition round-trips as-is.
    return task;
  }
}
