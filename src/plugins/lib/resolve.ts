export type ResolvedTarget = {
  href: string;
  localPath?: string;
};

/**
 * Resolve a markdown link target against the current file. Absolute web/mail
 * targets pass through; relative paths resolve via the main process so the
 * editor's click handler can open local files.
 */
export function resolveLinkTarget(
  target: string,
  filePath: string | null
): ResolvedTarget | null {
  if (/^(https?:|mailto:)/i.test(target) || target.startsWith('//')) {
    return { href: target };
  }

  if (/^file:\/\//i.test(target)) {
    return { href: target };
  }

  if (!filePath) return null;
  const resolved = window.inkfab.resolveFileTarget(filePath, target);
  if (!resolved) return null;

  return {
    href: resolved.fileUrl,
    localPath: resolved.filePath,
  };
}

export function resolveImageSource(
  target: string,
  filePath: string | null
): string | null {
  if (/^(https?:)?\/\//i.test(target) || /^data:/i.test(target)) return target;
  if (/^file:\/\//i.test(target)) return target;
  if (!filePath) return null;
  return window.inkfab.resolveFileTarget(filePath, target)?.fileUrl ?? null;
}
