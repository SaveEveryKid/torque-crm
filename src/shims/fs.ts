// pst-extractor imports Node's fs; in the browser it only reads from memory, so fs is never used.
export const openSync = () => {
  throw new Error('No file system in the browser.');
};
export const readSync = openSync;
export default { openSync, readSync };
