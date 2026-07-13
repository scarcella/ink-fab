export {};

declare global {
  interface Window {
    inkfab: {
      openFile: () => Promise<{ filePath: string; content: string } | null>;
      readFile: (filePath: string) => Promise<string>;
      saveFile: (filePath: string | null, content: string) => Promise<string | null>;
      confirmUnsavedChanges: (
        action: 'open' | 'navigate' | 'new' | 'close-tab',
        filePath: string | null
      ) => Promise<'save' | 'discard' | 'cancel'>;
      setDirty: (dirty: boolean) => void;
      setCurrentFile: (filePath: string | null) => void;
      completeCloseAfterSave: (saved: boolean) => void;
      openExternal: (url: string) => Promise<void>;
      openPath: (filePath: string) => Promise<string>;
      resolveFileTarget: (
        baseFilePath: string,
        target: string
      ) => { filePath: string; fileUrl: string } | null;
      onMenu: (
        handler: (
          action:
            | 'new'
            | 'open'
            | 'save'
            | 'save-as'
            | 'close-tab'
            | 'toggle-preview'
            | 'save-and-close'
        ) => void
      ) => () => void;
    };
  }
}
