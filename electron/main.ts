import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import https from 'node:https'
import http from 'node:http'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
// Lazy require for CJS packages (after createRequire defined)
const extractZip = require('extract-zip') as (src: string, opts: { dir: string }) => Promise<void>
const sevenBin = require('7zip-bin')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getSevenBinary(): string {
  try {
    if (process.platform === 'win32') {
      const candidates = [
        path.join(process.env['ProgramFiles'] || 'C:/Program Files', '7-Zip', '7z.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', '7-Zip', '7z.exe'),
      ]
      for (const p of candidates) {
        try { if (fs.existsSync(p)) return p } catch {}
      }
    }
  } catch {}
  return sevenBin.path7za as string
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let splash: BrowserWindow | null = null
let watcher: fs.FSWatcher | null = null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: 1400,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    show: false, // show after renderer notifies ready (or fallback)
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Remove the application menu and hide the menu bar entirely
  try { Menu.setApplicationMenu(null) } catch {}
  try { win.setMenuBarVisibility(false) } catch {}

  // When main has finished loading, set a fallback to show the window in case renderer never notifies ready
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
    // Fallback: show main after a short delay if splash hasn't been closed yet
    setTimeout(() => {
      if (win && !win.isVisible()) {
        try { win.show() } catch {}
        try { splash?.close() } catch {}
        splash = null
      }
    }, 7000)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function createSplashWindow() {
  try { splash?.close() } catch {}
  const splashPath = path.join(process.env.VITE_PUBLIC, 'splash.html')
  splash = new BrowserWindow({
    width: 460,
    height: 140,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    center: true,
    show: true,
    skipTaskbar: true,
  })
  try { splash.loadFile(splashPath) } catch {}
}

app.whenReady().then(() => {
  createSplashWindow()
  createWindow()
})

// Start FS watcher when modsRoot exists
app.whenReady().then(async () => {
  const { modsRoot } = await readSettings()
  if (modsRoot) setupWatcher(modsRoot)
})

// Renderer will notify when initial data is loaded; then close splash and show main
ipcMain.on('renderer:ready', () => {
  try { win?.show() } catch {}
  try { splash?.close() } catch {}
  splash = null
})

// --------------------------- Helpers ---------------------------
const userDataDir = () => app.getPath('userData')
const settingsPath = () => path.join(userDataDir(), 'settings.json')

type Settings = {
  modsRoot?: string
  imagesRoot?: string
}

async function readSettings(): Promise<Settings> {
  try {
    const buf = await fsp.readFile(settingsPath(), 'utf-8')
    return JSON.parse(buf)
  } catch {
    return {}
  }
}

async function writeSettings(s: Settings) {
  await fsp.mkdir(userDataDir(), { recursive: true })
  await fsp.writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}

function ensureDirSync(p: string) {
  fs.mkdirSync(p, { recursive: true })
}

function isDirectory(full: string) {
  try {
    return fs.statSync(full).isDirectory()
  } catch {
    return false
  }
}

function isFile(full: string) {
  try {
    return fs.statSync(full).isFile()
  } catch {
    return false
  }
}

// Archive extraction supporting zip and 7z/rar via 7zip
async function extractArchive(archivePath: string, destDir: string) {
  await fsp.mkdir(destDir, { recursive: true })
  const ext = path.extname(archivePath).toLowerCase()
  if (ext === '.zip') {
    await extractZip(archivePath, { dir: destDir })
    return
  }
  // Use 7zip for other formats
  const sevenPath = getSevenBinary()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenPath, ['x', archivePath, `-o"${destDir}"`, '-y'])
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('7zip exit ' + code))))
  })
}

function setupWatcher(root: string) {
  try { watcher?.close() } catch {}
  try {
    watcher = fs.watch(root, { recursive: true }, (() => {
      let t: NodeJS.Timeout | null = null
      return (_event, _file) => {
        if (t) clearTimeout(t)
        t = setTimeout(() => {
          win?.webContents.send('fs-changed', { root })
        }, 500)
      }
    })())
  } catch (e) {
    // ignore watch errors (e.g., unavailable recursive on some fs)
  }
}

// Download a file to a temp path
async function downloadToTemp(url: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `zzzmm_${Date.now()}`)
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tmp)
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle redirects
        https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res2) => res2.pipe(file))
          .on('error', reject)
        file.on('finish', () => file.close(() => resolve()))
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
  return tmp
}

// --------------------------- Images (data URL helper) ---------------------------
function guessMimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

ipcMain.handle('images:readDataUrl', async (_e, absPath: string) => {
  try {
    const buf = await fsp.readFile(absPath)
    const mime = guessMimeFromPath(absPath)
    const base64 = buf.toString('base64')
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
})

// Read preview.* from inside a mod archive and return as data URL
ipcMain.handle('mods:getPreviewDataUrl', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return null
  const cdir = characterDir(modsRoot, character)
  try {
    const files = await fsp.readdir(cdir)
    const target = files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
      || files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.toLowerCase().includes(modName.toLowerCase()))
    if (!target) return null
    const archivePath = path.join(cdir, target)
    // Extract preview.* to temp dir
    const tmpDir = path.join(os.tmpdir(), `zzzmm_prev_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    await fsp.mkdir(tmpDir, { recursive: true })
    const sevenPath = getSevenBinary()
    await new Promise<void>((resolve) => {
      const child = spawn(sevenPath, ['x', archivePath, 'preview.*', `-o"${tmpDir}"`, '-y'])
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
    // Find extracted file
    const candidates = ['preview.png', 'preview.jpg', 'preview.jpeg', 'preview.webp', 'preview.gif']
    for (const name of candidates) {
      const full = path.join(tmpDir, name)
      if (fs.existsSync(full)) {
        try {
          const buf = await fsp.readFile(full)
          const mime = guessMimeFromPath(full)
          const base64 = buf.toString('base64')
          return `data:${mime};base64,${base64}`
        } catch {}
      }
    }
    try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
    return null
  } catch {
    return null
  }
})

// Read data file from inside mod archive; supports 'data.txt' (preferred) and legacy 'data'. Returns JSON { pageUrl?, imageUrl? }
ipcMain.handle('mods:getData', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return null
  const cdir = characterDir(modsRoot, character)
  try {
    // Folder-based mod: read data.txt or legacy data directly from folder if present
    const folderPath = modDir(modsRoot, character, modName)
    if (isDirectory(folderPath)) {
      try {
        const dataTxt = path.join(folderPath, 'data.txt')
        const dataLegacy = path.join(folderPath, 'data')
        const chosen = fs.existsSync(dataTxt) ? dataTxt : (fs.existsSync(dataLegacy) ? dataLegacy : null)
        if (chosen) {
          try {
            const raw = await fsp.readFile(chosen, 'utf-8')
            const j = JSON.parse(raw)
            if (j && typeof j === 'object') return { pageUrl: j.pageUrl || undefined, imageUrl: j.imageUrl || undefined }
          } catch {}
        }
      } catch {}
    }
    const files = await fsp.readdir(cdir)
    const target = files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
      || files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.toLowerCase().includes(modName.toLowerCase()))
    if (!target) return null
  const archivePath = path.join(cdir, target)
  const tmpDir = path.join(os.tmpdir(), `zzzmm_data_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    await fsp.mkdir(tmpDir, { recursive: true })
    const sevenPath = getSevenBinary()
    // Try extracting 'data.txt' first, then legacy 'data'
    await new Promise<void>((resolve) => {
      const child = spawn(sevenPath, ['x', archivePath, 'data.txt', `-o"${tmpDir}"`, '-y'])
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
    await new Promise<void>((resolve) => {
      const child = spawn(sevenPath, ['x', archivePath, 'data', `-o"${tmpDir}"`, '-y'])
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
    const dataTxt = path.join(tmpDir, 'data.txt')
    const dataLegacy = path.join(tmpDir, 'data')
    let json: any = null
    const chosen = fs.existsSync(dataTxt) ? dataTxt : (fs.existsSync(dataLegacy) ? dataLegacy : null)
    if (chosen) {
      try {
        const raw = await fsp.readFile(chosen, 'utf-8')
        json = JSON.parse(raw)
      } catch {
        try { json = JSON.parse(String(await fsp.readFile(chosen))) } catch { json = null }
      }
    }
    try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
    if (json && typeof json === 'object') {
      return { pageUrl: json.pageUrl || undefined, imageUrl: json.imageUrl || undefined }
    }
    return null
  } catch {
    return null
  }
})

// Write (or overwrite) data.txt file inside mod archive (removes legacy 'data' if present)
ipcMain.handle('mods:setData', async (_e, character: string, modName: string, payload: { pageUrl?: string; imageUrl?: string }) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const folderPath = modDir(modsRoot, character, modName)
  // Folder-based: write data.txt directly
  if (isDirectory(folderPath)) {
    const dataTxt = path.join(folderPath, 'data.txt')
    await fsp.writeFile(dataTxt, JSON.stringify({ pageUrl: payload.pageUrl || undefined, imageUrl: payload.imageUrl || undefined }, null, 2), 'utf-8')
    try { await fsp.unlink(path.join(folderPath, 'data')) } catch {}
    return true
  }
  // Archive-based fallback
  const cdir = characterDir(modsRoot, character)
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) throw new Error('Archive not found')
  const archivePath = path.join(cdir, target)
  const tmpDir = path.join(os.tmpdir(), `zzzmm_dataw_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  await fsp.mkdir(tmpDir, { recursive: true })
  const dataFile = path.join(tmpDir, 'data.txt')
  await fsp.writeFile(dataFile, JSON.stringify({ pageUrl: payload.pageUrl || undefined, imageUrl: payload.imageUrl || undefined }, null, 2), 'utf-8')
  const sevenPath = getSevenBinary()
  await new Promise<void>((resolve) => {
    const child = spawn(sevenPath, ['d', archivePath, 'data'])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
  await new Promise<void>((resolve) => {
    const child = spawn(sevenPath, ['d', archivePath, 'data.txt'])
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenPath, ['a', archivePath, 'data.txt', '-y'], { cwd: tmpDir })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('7zip add exit ' + code))) )
  })
  try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
  return true
})

// Get primary internal name (first top-level item excluding preview.* and data)
ipcMain.handle('mods:getPrimaryInternalName', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return null
  const cdir = characterDir(modsRoot, character)
  try {
    // Folder-based mod: choose first top-level entry excluding data/data.txt and preview.* (prefer directory)
    const folderPath = modDir(modsRoot, character, modName)
    if (isDirectory(folderPath)) {
      try {
        const ents = await fsp.readdir(folderPath, { withFileTypes: true })
        const filtered = ents.filter((e) => {
          const n = e.name.toLowerCase()
          if (n === 'data' || n === 'data.txt') return false
          if (/^preview\.(png|jpe?g|webp|gif)$/i.test(n)) return false
          return true
        })
        if (filtered.length === 0) return null
        const dirEnt = filtered.find(e => e.isDirectory())
        return (dirEnt ? dirEnt.name : filtered[0].name)
      } catch {}
    }
    const files = await fsp.readdir(cdir)
    const target = files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
      || files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.toLowerCase().includes(modName.toLowerCase()))
    if (!target) return null
    const archPath = path.join(cdir, target)
    return await getPrimaryInternalNameFromArchive(archPath)
  } catch {
    return null
  }
})

// Rename primary internal folder/file inside archive
ipcMain.handle('mods:renamePrimaryInternal', async (_e, character: string, modName: string, newInternalName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!newInternalName?.trim()) return { changed: false }
  const folderPath = modDir(modsRoot, character, modName)
  if (isDirectory(folderPath)) {
    const ents = await fsp.readdir(folderPath, { withFileTypes: true })
    const filtered = ents.filter((e) => {
      const n = e.name.toLowerCase()
      if (n === 'data' || n === 'data.txt') return false
      if (/^preview\.(png|jpe?g|webp|gif)$/i.test(n)) return false
      return true
    })
    if (filtered.length === 0) return { changed: false }
    const primary = (filtered.find(e => e.isDirectory()) || filtered[0]).name
    if (primary === newInternalName) return { changed: false }
    const from = path.join(folderPath, primary)
    const to = path.join(folderPath, newInternalName)
    try { await fsp.access(to); throw new Error('Target already exists') } catch {}
    await fsp.rename(from, to)
    return { changed: true }
  }
  const cdir = characterDir(modsRoot, character)
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) throw new Error('Archive not found')
  const archPath = path.join(cdir, target)
  const current = await getPrimaryInternalNameFromArchive(archPath)
  if (!current || current === newInternalName) return { changed: false }
  const sevenPath = getSevenBinary()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenPath, ['rn', archPath, current, newInternalName])
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('7zip rn exit ' + code))) )
  })
  return { changed: true }
})

// Get the top-level internal folder name inside the archive (e.g., "carpetaX").
// We DO NOT modify the archive; we only list its contents.

// Fetch an image from URL and return a data URL (avoids renderer CORS issues)
ipcMain.handle('images:fetchAsDataUrl', async (_e, imageUrl: string) => {
  async function fetchBuffer(u: string, redirectDepth = 3): Promise<{ buf: Buffer; mime: string }> {
    return await new Promise((resolve, reject) => {
      let client: typeof https | typeof http = https
      try { const proto = new URL(u).protocol; client = proto === 'http:' ? http : https } catch {}
      client.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectDepth <= 0) return reject(new Error('Too many redirects'))
          fetchBuffer(res.headers.location, redirectDepth - 1).then(resolve, reject)
          return
        }
        if (status !== 200) return reject(new Error(`HTTP ${status}`))
        const mime = (res.headers['content-type'] || 'application/octet-stream').split(';')[0]
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        res.on('end', () => resolve({ buf: Buffer.concat(chunks), mime }))
        res.on('error', reject)
      }).on('error', reject)
    })
  }

  const { buf, mime } = await fetchBuffer(imageUrl)
  const safeMime = /^image\//.test(mime) ? mime : 'image/png'
  const base64 = buf.toString('base64')
  return `data:${safeMime};base64,${base64}`
})

// Save an image from URL into imagesRoot/<character>/icon.ext
ipcMain.handle('images:saveFromUrl', async (_e, character: string, imageUrl: string, crop?: any) => {
  const { imagesRoot } = await readSettings()
  if (!imagesRoot) throw new Error('Images root not set')
  if (!character?.trim()) throw new Error('Character name required')
  if (!imageUrl?.trim()) throw new Error('Image URL required')
  const dir = path.join(imagesRoot, character)
  ensureDirSync(dir)

  let urlExt = '.png'
  try {
    const u = new URL(imageUrl)
    const e = path.extname(u.pathname).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) urlExt = e
  } catch {
    // ignore URL parse errors; keep default
  }
  // Save with same name as the character folder (requested behavior)
  const safeName = character
  const finalPath = path.join(dir, `${safeName}${urlExt}`)

  const tmp = await downloadToTemp(imageUrl)
  try {
    await fsp.copyFile(tmp, finalPath)
  } finally {
    try { await fsp.unlink(tmp) } catch {}
  }
  // Also persist the source URL and optional crop as JSON in <Character>.txt for editing reference
  const urlTxt = path.join(dir, `${safeName}.txt`)
  const payload: any = { url: imageUrl }
  if (crop) payload.crop = crop
  try { await fsp.writeFile(urlTxt, JSON.stringify(payload, null, 2), 'utf-8') } catch {}
  return finalPath
})

// Save an image provided as a data URL (PNG/JPEG/WebP) to DataBase and optionally persist the source URL in a .txt
ipcMain.handle('images:saveFromDataUrl', async (_e, character: string, dataUrl: string, sourceUrl?: string, crop?: any) => {
  const { imagesRoot } = await readSettings()
  if (!imagesRoot) throw new Error('Images root not set')
  if (!character?.trim()) throw new Error('Character name required')
  if (!dataUrl?.startsWith('data:')) throw new Error('Invalid data URL')

  const dir = path.join(imagesRoot, character)
  ensureDirSync(dir)

  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl)
  if (!m) throw new Error('Unsupported data URL')
  const mime = m[1]
  const b64 = m[2]
  const buf = Buffer.from(b64, 'base64')

  let ext = '.png'
  if (mime.includes('jpeg')) ext = '.jpg'
  else if (mime.includes('webp')) ext = '.webp'
  else if (mime.includes('gif')) ext = '.gif'

  const finalPath = path.join(dir, `${character}${ext}`)
  await fsp.writeFile(finalPath, buf)
  if (sourceUrl || crop) {
    const payload: any = {}
    if (sourceUrl) payload.url = sourceUrl
    if (crop) payload.crop = crop
    try { await fsp.writeFile(path.join(dir, `${character}.txt`), JSON.stringify(payload, null, 2), 'utf-8') } catch {}
  }
  return finalPath
})

// Fetch DataBase info for a character: image path and saved URL
ipcMain.handle('database:getCharacterInfo', async (_e, character: string) => {
  const { imagesRoot } = await readSettings()
  if (!imagesRoot) return { imagePath: null, url: null }
  const dir = path.join(imagesRoot, character)
  const imagePath = pickFirstImageFile(dir, character)
  let url: string | null = null
  let crop: any = null
  try {
    const raw = await fsp.readFile(path.join(dir, `${character}.txt`), 'utf-8')
    try {
      const j = JSON.parse(raw)
      if (j && typeof j === 'object') {
        url = (j.url || '').trim() || null
        if (j.crop && typeof j.crop === 'object') crop = j.crop
      } else {
        url = String(raw).trim()
      }
    } catch {
      url = String(raw).trim()
    }
  } catch {}
  return { imagePath, url, crop }
})

// --------------------------- Data Model ---------------------------
type ModMeta = {
  name: string
  version?: string
  author?: string
  description?: string
  pageUrl?: string
  updateUrl?: string
  image?: string // relative file name inside the mod folder
  enabled?: boolean
  updatedAt?: string
  createdAt?: string
}

function characterDir(root: string, character: string) {
  return path.join(root, character)
}

function modDir(root: string, character: string, modName: string) {
  return path.join(characterDir(root, character), modName)
}

async function readModMeta(dir: string): Promise<ModMeta> {
  const metaPath = path.join(dir, 'mod.json')
  try {
    const raw = await fsp.readFile(metaPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    // derive from folder name
    return { name: path.basename(dir), enabled: true }
  }
}

async function writeModMeta(dir: string, meta: ModMeta) {
  const now = new Date().toISOString()
  const existing = await readModMeta(dir).catch(() => undefined)
  const merged: ModMeta = {
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    enabled: true,
    ...existing,
    ...meta,
  }
  await fsp.writeFile(path.join(dir, 'mod.json'), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

function pickFirstImageFile(dir: string, preferredBaseName?: string): string | null {
  try {
    const files = fs.readdirSync(dir)
    if (preferredBaseName) {
      const preferred = files.find((f) => new RegExp(`^${preferredBaseName}\\.(png|jpe?g|webp)$`, 'i').test(f))
      if (preferred && isFile(path.join(dir, preferred))) return path.join(dir, preferred)
    }
    const img = files.find((f) => /\.(png|jpe?g|webp)$/i.test(f) && isFile(path.join(dir, f)))
    return img ? path.join(dir, img) : null
  } catch {
    return null
  }
}

// --------------------------- IPC ---------------------------

// Helper: get archive file name for a mod under a character directory
// (helper removed)

// Helper: get primary internal name using machine-readable 7z output (-slt).
// Picks the first top-level entry excluding preview.* and data/data.txt. Prefers directories over files.
async function getPrimaryInternalNameFromArchive(archivePath: string): Promise<string | null> {
  const sevenPath = getSevenBinary()
  try {
    const output: string = await new Promise((resolve, reject) => {
      const child = spawn(sevenPath, ['l', '-slt', archivePath])
      let out = ''
      child.stdout.on('data', (d) => out += d.toString())
      child.on('error', reject)
      child.on('close', () => resolve(out))
    })
    const lines = output.split(/\r?\n/)
    type Entry = { path?: string; folderFlag?: boolean }
    const entries: Entry[] = []
    let cur: Entry | null = null
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) { if (cur && (cur.path)) entries.push(cur); cur = null; continue }
      const eq = line.indexOf('=')
      if (eq > 0) {
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        if (key === 'Path') {
          if (!cur) cur = {}
          cur.path = value
        } else if (key === 'Folder') {
          if (!cur) cur = {}
          cur.folderFlag = (value === '+' || value.toLowerCase() === 'yes' || value === '1')
        } else if (key === 'Attributes') {
          if (!cur) cur = {}
          if (/\bD/i.test(value)) cur.folderFlag = true
        }
      }
    }
    if (cur && cur.path) entries.push(cur)

    // Build top-level list preserving order
    const seen: string[] = []
    const isDirMap: Record<string, boolean> = {}
    const allPaths = entries.map(e => e.path!).filter(Boolean)
    const splitFirst = (p: string) => {
      const idx = Math.min(...['/', '\\'].map(ch => p.indexOf(ch)).filter(i => i >= 0))
      return idx >= 0 ? p.slice(0, idx) : p
    }

    for (const e of entries) {
      const p = e.path || ''
      if (!p) continue
      // Ignore non-entry headers like the archive file path (contains drive colon) or current dir markers
      if (p.includes(':')) continue
      if (p === '.' || p === './') continue
      const top = splitFirst(p)
      if (!top) continue
      const lower = top.toLowerCase()
      if (lower === 'data' || lower === 'data.txt') continue
      if (/^preview\./i.test(top)) continue
      if (!seen.includes(top)) seen.push(top)
      // Mark as directory if a folder entry matches or if any path has children under this top
      const hasChildren = allPaths.some(ap => ap !== top && (ap.startsWith(top + '/') || ap.startsWith(top + '\\')))
      const isDir = !!e.folderFlag || hasChildren
      if (isDir) isDirMap[top] = true
      else if (!(top in isDirMap)) isDirMap[top] = false
    }
    if (seen.length === 0) return null
    const dirTop = seen.find(t => isDirMap[t])
    return dirTop || seen[0]
  } catch {
    return null
  }
}

// Peek primary internal name from an arbitrary archive path (without copying into modsRoot)
ipcMain.handle('mods:peekPrimaryInternalName', async (_e, archivePath: string) => {
  if (!archivePath || typeof archivePath !== 'string') return null
  try {
    return await getPrimaryInternalNameFromArchive(archivePath)
  } catch {
    return null
  }
})

ipcMain.handle('settings:get', async () => {
  return readSettings()
})

ipcMain.handle('settings:setModsRoot', async (_e, root: string) => {
  const s = await readSettings()
  s.modsRoot = root
  await writeSettings(s)
  setupWatcher(root)
  return s
})

ipcMain.handle('settings:setImagesRoot', async (_e, root: string) => {
  const s = await readSettings()
  s.imagesRoot = root
  await writeSettings(s)
  return s
})

ipcMain.handle('dialog:selectFolder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

ipcMain.handle('dialog:selectArchive', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [
    { name: 'Archives', extensions: ['zip', '7z', 'rar'] },
  ] })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
})

ipcMain.handle('characters:list', async () => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return []
  try {
    const entries = await fsp.readdir(modsRoot)
    const dirs = entries.filter((n) => isDirectory(path.join(modsRoot, n)))
    // Return display names (strip DISABLED_ prefix) without duplicates
    const seen = new Set<string>()
    const result: string[] = []
    for (const d of dirs) {
      const base = d.replace(/^DISABLED_/i, '')
      if (!seen.has(base.toLowerCase())) {
        seen.add(base.toLowerCase())
        result.push(base)
      }
    }
    return result
  } catch {
    return []
  }
})

ipcMain.handle('characters:listWithImages', async () => {
  const { modsRoot, imagesRoot } = await readSettings()
  if (!modsRoot) return []
  try {
    const entries = await fsp.readdir(modsRoot)
    const dirs = entries.filter((n) => isDirectory(path.join(modsRoot, n)))
    // Build a map by base name stripping DISABLED_ prefix. Prefer non-prefixed if both exist.
    const bestFolderByBase: Record<string, string> = {}
    for (const d of dirs) {
      const base = d.replace(/^DISABLED_/i, '')
      const has = bestFolderByBase[base]
      if (!has) {
        bestFolderByBase[base] = d
      } else {
        // prefer non-disabled
        if (/^DISABLED_/i.test(has) && !/^DISABLED_/i.test(d)) bestFolderByBase[base] = d
      }
    }
    const names = Object.keys(bestFolderByBase)
    const items = names.map((name) => {
      const idir = imagesRoot ? path.join(imagesRoot, name) : null
      const imgPath = idir ? pickFirstImageFile(idir, name) : null
      return { name, imagePath: imgPath || undefined }
    })
    return items
  } catch {
    return []
  }
  // unreachable
})

// Enable character by removing DISABLED_ prefix from its folder
// Removed characters:enable/disable — character activation toggling no longer supported

ipcMain.handle('characters:add', async (_e, name: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const dir = characterDir(modsRoot, name)
  await fsp.mkdir(dir, { recursive: true })
  return name
})

ipcMain.handle('characters:rename', async (_e, oldName: string, newName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  // Support renaming whether the character is enabled or disabled
  let from = characterDir(modsRoot, oldName)
  let to = characterDir(modsRoot, newName)
  if (!isDirectory(from)) {
    const alt = characterDir(modsRoot, `DISABLED_${oldName}`)
    if (isDirectory(alt)) {
      from = alt
      to = characterDir(modsRoot, `DISABLED_${newName}`)
    }
  }
  if (!isDirectory(from)) throw new Error('Source character does not exist')
  if (from === to) return { changed: false }
  try {
    // Windows case-only rename workaround
    const caseOnly = oldName.toLowerCase() === newName.toLowerCase()
    if (caseOnly) {
      const temp = path.join(modsRoot, `${oldName}__tmp__${Date.now()}`)
      await fsp.rename(from, temp)
      await fsp.rename(temp, to)
    } else {
      // if target exists, error
      try { await fsp.access(to); throw new Error('Target already exists') } catch {}
      await fsp.rename(from, to)
    }
    // Notify renderer to refresh
    win?.webContents.send('fs-changed', { root: modsRoot })
    return { changed: true }
  } catch (e) {
    throw e
  }
})

ipcMain.handle('characters:normalizeNames', async () => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const entries = await fsp.readdir(modsRoot)
  const result: { changed: Array<{ from: string, to: string }>, skipped: string[] } = { changed: [], skipped: [] }

  function normalize(n: string) {
    const trimmed = n.trim()
    if (!trimmed) return n
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  }

  for (const name of entries) {
    const full = path.join(modsRoot, name)
    if (!isDirectory(full)) continue
    const targetName = normalize(name)
    if (targetName === name) continue
    const target = path.join(modsRoot, targetName)

    try {
      // Handle case-insensitive rename on Windows by renaming to a temp name first if needed
      const sameCaseOnly = name.toLowerCase() === targetName.toLowerCase()
      if (sameCaseOnly) {
        const temp = path.join(modsRoot, `${name}__tmp__${Date.now()}`)
        await fsp.rename(full, temp)
        await fsp.rename(temp, target)
      } else {
        // If target exists, skip
        try {
          await fsp.access(target)
          result.skipped.push(name)
          continue
        } catch {}
        await fsp.rename(full, target)
      }
      result.changed.push({ from: name, to: targetName })
    } catch {
      result.skipped.push(name)
    }
  }

  // Notify renderer to refresh
  win?.webContents.send('fs-changed', { root: modsRoot })
  return result
})

ipcMain.handle('characters:delete', async (_e, name: string) => {
  const { modsRoot, imagesRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!name?.trim()) throw new Error('Character name required')
  const cmods = characterDir(modsRoot, name)
  try {
    await fsp.rm(cmods, { recursive: true, force: true })
  } catch {}
  if (imagesRoot) {
    const cimgs = path.join(imagesRoot, name)
    try { await fsp.rm(cimgs, { recursive: true, force: true }) } catch {}
  }
  // Notify renderer to refresh
  try { win?.webContents.send('fs-changed', { root: modsRoot }) } catch {}
  return true
})

ipcMain.handle('mods:list', async (_e, character: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return []
  const cdir = characterDir(modsRoot, character)
  try {
    const entries = await fsp.readdir(cdir)
    const mods: any[] = []
    // Track names to avoid duplicates when both a folder and a flat archive share the same base name
    const seen = new Set<string>()
    // 1. Existing legacy mod folders
    for (const entry of entries) {
      const mdir = path.join(cdir, entry)
      if (!isDirectory(mdir)) continue
      const meta = await readModMeta(mdir)
      const imgCandidates = ['preview.png', 'preview.jpg', 'cover.png', 'cover.jpg']
      const img = meta.image && fs.existsSync(path.join(mdir, meta.image)) ? meta.image : imgCandidates.find((f) => fs.existsSync(path.join(mdir, f)))
      // New rule: folder name prefixed with DISABLED_ marks it disabled; we ignore inner archive naming now
      const enabled = !/^DISABLED_/i.test(entry)
      mods.push({ folder: entry, dir: mdir, meta: { ...meta, image: img, enabled }, archive: null })
      seen.add(entry.replace(/^DISABLED_/i, '').toLowerCase())
    }
    // 2. New flat archives directly inside the character directory (no per-mod folder)
    for (const entry of entries) {
      const full = path.join(cdir, entry)
      if (!isFile(full)) continue
      if (!/\.(zip|7z|rar)$/i.test(entry)) continue
      const isDisabled = /^DISABLED_/i.test(entry)
      const cleanName = entry.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '')
      if (seen.has(cleanName.toLowerCase())) continue
      // Preview is embedded inside the archive; do not set meta.image here
      const imgFile = null
      mods.push({
        folder: cleanName,
        dir: cdir, // character directory as base
        meta: { name: cleanName, enabled: !isDisabled, image: imgFile || undefined },
        archive: entry,
        flat: true,
      })
    }
    return mods
  } catch {
    return []
  }
})

// Activate one mod exclusively: ensure its archive(s) are not prefixed with DISABLED_, and prefix all others
ipcMain.handle('mods:activateExclusive', async (_e, character: string, targetMod: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!character?.trim() || !targetMod?.trim()) throw new Error('Character and target mod are required')
  const cdir = characterDir(modsRoot, character)
  const entries = await fsp.readdir(cdir)
  for (const m of entries) {
    const mdir = path.join(cdir, m)
    if (!isDirectory(mdir)) continue
    try {
      const files = await fsp.readdir(mdir)
      const archives = files.filter((f) => /\.(zip|7z|rar)$/i.test(f))
      for (const file of archives) {
        const from = path.join(mdir, file)
        const isDisabled = /^DISABLED_/i.test(file)
        if (m === targetMod) {
          // ensure active: remove DISABLED_ if present
          if (isDisabled) {
            const toName = file.replace(/^DISABLED_/i, '')
            const to = path.join(mdir, toName)
            try { await fsp.rm(to, { force: true }) } catch {}
            await fsp.rename(from, to)
          }
        } else {
          // ensure disabled: add DISABLED_ if missing
          if (!isDisabled) {
            const to = path.join(mdir, `DISABLED_${file}`)
            try { await fsp.rm(to, { force: true }) } catch {}
            await fsp.rename(from, to)
          }
        }
      }
      // update metadata enabled flag for clarity
      const enabled = (m === targetMod)
      await writeModMeta(mdir, { name: m, enabled })
    } catch {
      // ignore per-mod errors
    }
  }
  // Notify renderer
  try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
  return true
})

// Enable a single mod: remove DISABLED_ prefix from its archive(s) only
ipcMain.handle('mods:enable', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!character?.trim() || !modName?.trim()) throw new Error('Character and modName are required')
  const cdir = characterDir(modsRoot, character)
  // Normalize: allow passing folder name with or without DISABLED_ prefix
  const rawName = modName.replace(/^DISABLED_/i, '')
  // Try to locate the directory among both enabled and disabled variants (case-insensitive)
  const candidateEnabled = modDir(modsRoot, character, rawName)
  const candidateDisabled = modDir(modsRoot, character, `DISABLED_${rawName}`)
  let realDir: string | null = null
  if (isDirectory(candidateEnabled)) realDir = candidateEnabled
  else if (isDirectory(candidateDisabled)) realDir = candidateDisabled
  if (realDir && isDirectory(realDir)) {
    const baseFolder = path.basename(realDir)
    if (/^DISABLED_/i.test(baseFolder)) {
      const desiredBase = baseFolder.replace(/^DISABLED_/i, '')
      let target = modDir(modsRoot, character, desiredBase)
      if (target === realDir) return true
      // Collision handling: append (n) until unique
      if (isDirectory(target)) {
        let i = 2
        while (isDirectory(target)) {
          target = modDir(modsRoot, character, `${desiredBase} (${i++})`)
        }
      }
      await fsp.rename(realDir, target)
      try { await writeModMeta(target, { name: path.basename(target), enabled: true }) } catch {}
      try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
      return true
    }
    // Already enabled folder
    try { await writeModMeta(realDir, { name: rawName, enabled: true }) } catch {}
    return true
  }
  // Flat archive fallback: remove DISABLED_ prefix from archive filename
  const files = await fsp.readdir(cdir)
  const targetArch = files.find((f) => /^DISABLED_/i.test(f) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === rawName.toLowerCase())
    || files.find((f) => /^DISABLED_/i.test(f) && f.toLowerCase().includes(rawName.toLowerCase()))
  if (!targetArch) return false
  const from = path.join(cdir, targetArch)
  const to = path.join(cdir, targetArch.replace(/^DISABLED_/i, ''))
  try { await fsp.rm(to, { force: true }) } catch {}
  await fsp.rename(from, to)
  try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
  return true
})

// Flat archive enable (no folder) - separate handler for new structure
ipcMain.handle('mods:enableFlat', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const cdir = characterDir(modsRoot, character)
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => /^DISABLED_/i.test(f) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => /^DISABLED_/i.test(f) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) return false
  const from = path.join(cdir, target)
  const to = path.join(cdir, target.replace(/^DISABLED_/i, ''))
  try { await fsp.rm(to, { force: true }) } catch {}
  await fsp.rename(from, to)
  try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
  return true
})

// Disable a single mod: ensure its archive(s) are prefixed with DISABLED_
ipcMain.handle('mods:disable', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!character?.trim() || !modName?.trim()) throw new Error('Character and modName are required')
  const cdir = characterDir(modsRoot, character)
  const rawName = modName.replace(/^DISABLED_/i, '')
  const candidateEnabled = modDir(modsRoot, character, rawName)
  const candidateDisabled = modDir(modsRoot, character, `DISABLED_${rawName}`)
  let realDir: string | null = null
  if (isDirectory(candidateEnabled)) realDir = candidateEnabled
  else if (isDirectory(candidateDisabled)) realDir = candidateDisabled
  if (realDir && isDirectory(realDir)) {
    const baseFolder = path.basename(realDir)
    if (!/^DISABLED_/i.test(baseFolder)) {
      const target = modDir(modsRoot, character, `DISABLED_${baseFolder}`)
      // Collision safety: if target exists for some reason, append numeric suffix
      let finalTarget = target
      if (isDirectory(finalTarget)) {
        let i = 2
        while (isDirectory(finalTarget)) {
          finalTarget = modDir(modsRoot, character, `DISABLED_${baseFolder} (${i++})`)
        }
      }
      await fsp.rename(realDir, finalTarget)
      try { await writeModMeta(finalTarget, { name: baseFolder, enabled: false }) } catch {}
      try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
      return true
    }
    // Already disabled
    try { await writeModMeta(realDir, { name: rawName, enabled: false }) } catch {}
    return true
  }
  // Flat archive fallback: add DISABLED_ prefix to archive filename
  const files = await fsp.readdir(cdir)
  const targetArch = files.find((f) => !/^DISABLED_/i.test(f) && f.replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === rawName.toLowerCase())
    || files.find((f) => !/^DISABLED_/i.test(f) && f.toLowerCase().includes(rawName.toLowerCase()))
  if (!targetArch) return false
  const from = path.join(cdir, targetArch)
  const to = path.join(cdir, `DISABLED_${targetArch}`)
  try { await fsp.rm(to, { force: true }) } catch {}
  await fsp.rename(from, to)
  try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
  return true
})

// Flat archive disable (no folder)
ipcMain.handle('mods:disableFlat', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const cdir = characterDir(modsRoot, character)
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => !/^DISABLED_/i.test(f) && f.replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => !/^DISABLED_/i.test(f) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) return false
  const from = path.join(cdir, target)
  const to = path.join(cdir, `DISABLED_${target}`)
  try { await fsp.rm(to, { force: true }) } catch {}
  await fsp.rename(from, to)
  try { win?.webContents.send('fs-changed', { root: cdir }) } catch {}
  return true
})

ipcMain.handle('mods:addFromArchive', async (_e, character: string, archivePath: string, modName: string, meta: Partial<ModMeta> = {}) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const mdir = modDir(modsRoot, character, modName)
  ensureDirSync(mdir)
  await extractArchive(archivePath, mdir)
  await writeModMeta(mdir, { name: modName, ...meta })
  return true
})

// Removed legacy uniqueModName (no longer used)

ipcMain.handle('mods:copyArchiveToModFolder', async (_e, character: string, archivePath: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  if (!character?.trim()) throw new Error('Character required')
  if (!archivePath) throw new Error('Archive required')
  const originalName = path.basename(archivePath)
  const base = originalName.replace(/\.(zip|7z|rar)$/i, '')
  // Generate unique base name among existing archives (flat) and legacy folders
  const cdir = characterDir(modsRoot, character)
  await fsp.mkdir(cdir, { recursive: true })
  let modName = base
  let i = 2
  while (true) {
    const collisionArchive = ['.zip', '.7z', '.rar'].some((ext) => fs.existsSync(path.join(cdir, `${modName}${ext}`)) || fs.existsSync(path.join(cdir, `DISABLED_${modName}${ext}`)))
    const collisionFolder = fs.existsSync(path.join(cdir, modName))
    if (!collisionArchive && !collisionFolder) break
    modName = `${base} (${i++})`
  }
  // Create folder and extract archive there (convert archive to folder-based mod)
  const destDir = path.join(cdir, modName)
  await fsp.mkdir(destDir, { recursive: true })
  await extractArchive(archivePath, destDir)
  // Flatten single top-level folder
  try {
    const ents = await fsp.readdir(destDir, { withFileTypes: true })
    const fileCount = ents.filter(e => e.isFile()).length
    const dirEntries = ents.filter(e => e.isDirectory())
    if (fileCount === 0 && dirEntries.length === 1) {
      const inner = path.join(destDir, dirEntries[0].name)
      const innerItems = await fsp.readdir(inner)
      for (const name of innerItems) {
        await fsp.rename(path.join(inner, name), path.join(destDir, name))
      }
      try { await fsp.rmdir(inner) } catch {}
    }
  } catch {}
  try { await writeModMeta(destDir, { name: modName, enabled: true }) } catch {}
  return { modName, dir: cdir }
})

ipcMain.handle('mods:saveImageFromDataUrl', async (_e, character: string, modName: string, dataUrl: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const cdir = characterDir(modsRoot, character)
  await fsp.mkdir(cdir, { recursive: true })
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl)
  if (!m) throw new Error('Unsupported data URL')
  const mime = m[1]
  const b64 = m[2]
  const buf = Buffer.from(b64, 'base64')
  let ext = '.png'
  if (mime.includes('jpeg')) ext = '.jpg'
  else if (mime.includes('webp')) ext = '.webp'
  else if (mime.includes('gif')) ext = '.gif'
  // Folder-based: write preview file directly
  const mdir = modDir(modsRoot, character, modName)
  if (isDirectory(mdir)) {
    const out = path.join(mdir, `preview${ext}`)
    await fsp.writeFile(out, buf)
    return `preview${ext}`
  }
  // Find the target archive (prefer enabled)
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) throw new Error('Archive not found for mod')
  const archivePath = path.join(cdir, target)
  // Write temp preview file with the desired name
  const tmpDir = path.join(os.tmpdir(), `zzzmm_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  await fsp.mkdir(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `preview${ext}`)
  await fsp.writeFile(tmpFile, buf)
  // Add/update inside archive using 7z
  const sevenPath = getSevenBinary()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenPath, ['a', archivePath, 'preview' + ext, '-y'], { cwd: tmpDir })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('7zip add exit ' + code))))
  })
  try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
  return `preview${ext}`
})

ipcMain.handle('mods:saveImageFromUrl', async (_e, character: string, modName: string, imageUrl: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const cdir = characterDir(modsRoot, character)
  await fsp.mkdir(cdir, { recursive: true })
  // Download buffer
  const tmp = await downloadToTemp(imageUrl)
  let urlExt = '.png'
  try {
    const u = new URL(imageUrl)
    const e = path.extname(u.pathname).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) urlExt = e
  } catch {}
  // Folder-based: copy preview into folder
  const mdir2 = modDir(modsRoot, character, modName)
  if (isDirectory(mdir2)) {
    const out = path.join(mdir2, `preview${urlExt}`)
    await fsp.copyFile(tmp, out)
    try { await fsp.unlink(tmp) } catch {}
    return `preview${urlExt}`
  }
  // Find target archive
  const files = await fsp.readdir(cdir)
  const target = files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
    || files.find((f) => /\.(zip|7z|rar)$/i.test(f) && f.toLowerCase().includes(modName.toLowerCase()))
  if (!target) throw new Error('Archive not found for mod')
  const archivePath = path.join(cdir, target)
  // Place tmp image with desired name in a temp dir then add via 7z
  const tmpDir = path.join(os.tmpdir(), `zzzmm_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  await fsp.mkdir(tmpDir, { recursive: true })
  const tmpImg = path.join(tmpDir, `preview${urlExt}`)
  await fsp.copyFile(tmp, tmpImg)
  try { await fsp.unlink(tmp) } catch {}
  const sevenPath = getSevenBinary()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sevenPath, ['a', archivePath, path.basename(tmpImg), '-y'], { cwd: tmpDir })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('7zip add exit ' + code))))
  })
  try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
  return `preview${urlExt}`
})

// Add or upsert a mod entry into the character's DataBase JSON (no longer saves a copy like <Character>MOD<N>.*; we use per-mod preview files instead)
// Removed DataBase mod entry handlers (data now embedded per archive)

ipcMain.handle('mods:saveMetadata', async (_e, character: string, modName: string, meta: Partial<ModMeta>) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const mdir = modDir(modsRoot, character, modName)
  if (isDirectory(mdir)) {
    const saved = await writeModMeta(mdir, { name: modName, ...meta })
    return saved
  }
  // Flat mods: persist nothing here; metadata handled via archive data file + preview
  return { name: modName, ...meta } as ModMeta
})

ipcMain.handle('mods:delete', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const mdir = modDir(modsRoot, character, modName)
  if (isDirectory(mdir)) {
    await fsp.rm(mdir, { recursive: true, force: true })
  } else {
    const cdir = characterDir(modsRoot, character)
    // Remove archive (enabled or disabled) matching modName and the preview file
    try {
      const files = await fsp.readdir(cdir)
      const arch = files.find((f) => f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
      if (arch) { try { await fsp.unlink(path.join(cdir, arch)) } catch {} }
      const preview = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].map((e) => `${modName}.preview${e}`).find((f) => fs.existsSync(path.join(cdir, f)))
      if (preview) { try { await fsp.unlink(path.join(cdir, preview)) } catch {} }
    } catch {}
  }
  return true
})

ipcMain.handle('mods:openPage', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return false
  // Folder-based: read data.txt directly
  try {
    const folderPath = modDir(modsRoot, character, modName)
    if (isDirectory(folderPath)) {
      const dataTxt = path.join(folderPath, 'data.txt')
      const dataLegacy = path.join(folderPath, 'data')
      const chosen = fs.existsSync(dataTxt) ? dataTxt : (fs.existsSync(dataLegacy) ? dataLegacy : null)
      if (chosen) {
        try { const j = JSON.parse(await fsp.readFile(chosen, 'utf-8')); if (j?.pageUrl) { await shell.openExternal(j.pageUrl); return true } } catch {}
      }
    }
  } catch {}
  // 1) Try archive-embedded data file first
  try {
    const cdir = characterDir(modsRoot, character)
    const files = await fsp.readdir(cdir)
    const target = files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.replace(/^DISABLED_/i, '').replace(/\.(zip|7z|rar)$/i, '').toLowerCase() === modName.toLowerCase())
      || files.find((f) => /(zip|7z|rar)$/i.test(path.extname(f)) && f.toLowerCase().includes(modName.toLowerCase()))
    if (target) {
      const archPath = path.join(cdir, target)
      const tmpDir = path.join(os.tmpdir(), `zzzmm_open_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      await fsp.mkdir(tmpDir, { recursive: true })
      const sevenPath = getSevenBinary()
      // Try both data.txt and legacy data
      await new Promise<void>((resolve) => {
        const child = spawn(sevenPath, ['x', archPath, 'data.txt', `-o"${tmpDir}"`, '-y'])
        child.on('error', () => resolve())
        child.on('close', () => resolve())
      })
      await new Promise<void>((resolve) => {
        const child = spawn(sevenPath, ['x', archPath, 'data', `-o"${tmpDir}"`, '-y'])
        child.on('error', () => resolve())
        child.on('close', () => resolve())
      })
      const dataTxt = path.join(tmpDir, 'data.txt')
      const dataLegacy = path.join(tmpDir, 'data')
      const chosen = fs.existsSync(dataTxt) ? dataTxt : (fs.existsSync(dataLegacy) ? dataLegacy : null)
      if (chosen) {
        try {
          const raw = await fsp.readFile(chosen, 'utf-8')
          const j = JSON.parse(raw)
          if (j?.pageUrl) { await shell.openExternal(j.pageUrl); try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}; return true }
        } catch {}
      }
      try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch {}
    }
  } catch {}
  // 2) Fallback to legacy mod.json
  const mdir = modDir(modsRoot, character, modName)
  if (isDirectory(mdir)) {
    const meta = await readModMeta(mdir)
    if (meta.pageUrl) { await shell.openExternal(meta.pageUrl); return true }
  }
  return false
})

ipcMain.handle('mods:openFolder', async (_e, character: string, modName?: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) return false
  let target = modsRoot
  if (character) target = characterDir(modsRoot, character)
  if (modName) {
    const mdir = modDir(modsRoot, character, modName)
    target = isDirectory(mdir) ? mdir : characterDir(modsRoot, character)
  }
  await shell.openPath(target)
  return true
})

ipcMain.handle('mods:updateFromUrl', async (_e, character: string, modName: string) => {
  const { modsRoot } = await readSettings()
  if (!modsRoot) throw new Error('Mods root not set')
  const mdir = modDir(modsRoot, character, modName)
  const meta = await readModMeta(mdir)
  if (!meta.updateUrl) throw new Error('No updateUrl in mod.json')
  const tmp = await downloadToTemp(meta.updateUrl)
  await extractArchive(tmp, mdir)
  await writeModMeta(mdir, { ...meta, name: modName })
  try { await fsp.unlink(tmp) } catch {}
  return true
})

// Note: 'characters:updateImages' feature was removed intentionally.

// --------------------------- FS Utilities ---------------------------
// Delete a file if it resides under modsRoot or imagesRoot
ipcMain.handle('fs:deleteFile', async (_e, absPath: string) => {
  if (!absPath || typeof absPath !== 'string') return false
  try {
    const s = await readSettings()
    const allowRoots = [s.modsRoot, s.imagesRoot].filter(Boolean) as string[]
    const normalized = path.resolve(absPath)
    const isAllowed = allowRoots.some((root) => normalized.startsWith(path.resolve(root)))
    if (!isAllowed) return false
    await fsp.unlink(normalized)
    return true
  } catch {
    return false
  }
})
