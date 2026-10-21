/** The folder can't be read as a vault at all (as opposed to a problem in one file). */
export class VaultError extends Error {
  override name = 'VaultError';
}
