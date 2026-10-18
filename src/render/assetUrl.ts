/**
 * Content versions of the runtime textures under /textures that a page fetches by a fixed name (from assets.json, put in
 * by vite.config.ts). A versioned URL changes whenever the file does, so the deploy can mark these files immutable and
 * a returning player's browser reuses them without asking the server again.
 */
declare const __TEXTURE_VERSIONS__: Record<string, string> | undefined;

const VERSIONS: Record<string, string> = typeof __TEXTURE_VERSIONS__ === 'object' && __TEXTURE_VERSIONS__ ? __TEXTURE_VERSIONS__ : {};

/** `/textures/x/diff.jpg` → `/textures/x/diff.jpg?v=<hash>`; a path assets.json does not list is returned as it is. */
export function versioned(path: string) {
  const v = VERSIONS[path];
  return v ? `${path}?v=${v}` : path;
}
