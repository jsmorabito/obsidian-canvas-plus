/** Characters a file name can't hold. */
export const UNSAFE_NAME = /[\\/:*?"<>|#^[\]]/g;
/** Well under the file system's limit, which counts the folder and extension too. */
export const MAX_NAME = 100;

/**
 * A note's title from some text: what a file name can hold, and short enough to be one. Empty when nothing is left.
 */
export function titleFromText(text: string): string {
  return text.replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}
