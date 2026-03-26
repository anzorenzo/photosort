const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scanFolder: (p) => ipcRenderer.invoke('scan-folder', p),
  scanFolderFlat: (p) => ipcRenderer.invoke('scan-folder-flat', p),
  readMetadata: (p) => ipcRenderer.invoke('read-metadata', p),
  doSort: (outputFolder, plan, moveFiles) => ipcRenderer.invoke('do-sort', { outputFolder, plan, moveFiles }),
  resolveDroppedFolder: (p) => ipcRenderer.invoke('resolve-dropped-folder', p),
  listSubfolders: (p) => ipcRenderer.invoke('list-subfolders', p),
  renameFile: (filePath, newName) => ipcRenderer.invoke('rename-file', { filePath, newName }),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  getFileUrl: (p) => ipcRenderer.invoke('get-file-url', p),
  generateThumb: (p) => ipcRenderer.invoke('generate-thumb', p),
  onSortProgress: (cb) => ipcRenderer.on('sort-progress', (_, data) => cb(data)),
  winMinimize: () => ipcRenderer.invoke('win-minimize'),
  winMaximize: () => ipcRenderer.invoke('win-maximize'),
  winClose: () => ipcRenderer.invoke('win-close'),
  setBgColor: (color) => ipcRenderer.invoke('set-bg-color', color),
  onWinStateChange: (cb) => ipcRenderer.on('win-state-change', (_, maximized) => cb(maximized))
})
