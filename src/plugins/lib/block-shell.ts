// Block widgets must not carry vertical margins — CodeMirror measures widget
// height without them, which corrupts click/arrow-key position mapping. The
// shell provides the spacing as padding; the inner card keeps border/background.
export function blockShell(child: HTMLElement): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'cm-block-shell';
  shell.appendChild(child);
  return shell;
}
