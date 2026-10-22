import { applyPlan } from './apply.ts';
import { createTaskFile, trashTaskFile, updateTaskFile } from './files.ts';
import { loadVault } from './load.ts';
import { appendLog } from './log.ts';

/**
 * A vault in a folder on disk, in the shape the commands layer asks for
 * (its VaultAccess). Another storage, e.g. Obsidian's vault API on a phone,
 * would provide the same functions.
 */
export function fileVault(root: string) {
  return {
    root,
    load: () => loadVault(root),
    applyPlan,
    appendLog,
    createTask: createTaskFile,
    updateTask: updateTaskFile,
    trashTask: trashTaskFile,
  };
}
