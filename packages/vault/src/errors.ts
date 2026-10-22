/**
 * A request about the vault can't be done: the folder isn't a vault, a task
 * doesn't exist, or a rule refuses it (e.g. undoing yesterday's done).
 */
export class VaultError extends Error {
  override name = 'VaultError';
  readonly code: 'not_found' | 'invalid_input' | 'refused';

  constructor(message: string, code: VaultError['code'] = 'refused') {
    super(message);
    this.code = code;
  }
}
