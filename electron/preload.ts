import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose a safe API to the Renderer process ---------
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setModsRoot: (root: string) => ipcRenderer.invoke('settings:setModsRoot', root),
  setImagesRoot: (root: string) => ipcRenderer.invoke('settings:setImagesRoot', root),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectArchive: () => ipcRenderer.invoke('dialog:selectArchive'),

  listCharacters: () => ipcRenderer.invoke('characters:list'),
  listCharactersWithImages: () => ipcRenderer.invoke('characters:listWithImages'),
  addCharacter: (name: string) => ipcRenderer.invoke('characters:add', name),
  renameCharacter: (oldName: string, newName: string) => ipcRenderer.invoke('characters:rename', oldName, newName),
  normalizeCharacterNames: () => ipcRenderer.invoke('characters:normalizeNames'),

  listMods: (character: string) => ipcRenderer.invoke('mods:list', character),
  addModFromArchive: (character: string, archivePath: string, modName: string, meta?: any) => ipcRenderer.invoke('mods:addFromArchive', character, archivePath, modName, meta),
  saveModMetadata: (character: string, modName: string, meta: any) => ipcRenderer.invoke('mods:saveMetadata', character, modName, meta),
  deleteMod: (character: string, modName: string) => ipcRenderer.invoke('mods:delete', character, modName),
  openModPage: (character: string, modName: string) => ipcRenderer.invoke('mods:openPage', character, modName),
  openFolder: (character?: string, modName?: string) => ipcRenderer.invoke('mods:openFolder', character, modName),
  updateFromUrl: (character: string, modName: string) => ipcRenderer.invoke('mods:updateFromUrl', character, modName),
  readImageAsDataUrl: (absPath: string) => ipcRenderer.invoke('images:readDataUrl', absPath),
  saveImageFromUrl: (character: string, url: string, crop?: any) => ipcRenderer.invoke('images:saveFromUrl', character, url, crop),
  fetchImageDataUrl: (url: string) => ipcRenderer.invoke('images:fetchAsDataUrl', url),
  saveImageFromDataUrl: (character: string, dataUrl: string, sourceUrl?: string, crop?: any) => ipcRenderer.invoke('images:saveFromDataUrl', character, dataUrl, sourceUrl, crop),
  getCharacterInfo: (character: string) => ipcRenderer.invoke('database:getCharacterInfo', character),
  onFsChanged: (cb: (payload: any) => void) => {
    const handler = (_e: any, payload: any) => cb(payload)
    ipcRenderer.on('fs-changed', handler)
    return () => ipcRenderer.off('fs-changed', handler)
  },
})
