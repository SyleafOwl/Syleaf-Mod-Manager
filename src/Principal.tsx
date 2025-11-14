import { useEffect, useMemo, useRef, useState } from 'react'
import './Principal.css'
import Actualizar from './Actualizar'
import Configuracion from './Configuracion'
import Agregar from './Agregar'
import Editar from './Editar'
import Eliminar from './Eliminar'
import AgregarMod from './AgregarMod'
import EliminarMod from './EliminarMod'
import EditarMod from './EditarMod'

type ModMeta = {
  name: string
  version?: string
  author?: string
  description?: string
  pageUrl?: string
  updateUrl?: string
  image?: string
  enabled?: boolean
  createdAt?: string
  updatedAt?: string
}

type ModItem = {
  folder: string
  dir: string
  meta: ModMeta
  archive?: string | null
}

type Settings = { modsRoot?: string; imagesRoot?: string }
type CharacterItem = { name: string; imagePath?: string }
type CropMeta = { x: number; y: number; width: number; height: number; originalWidth: number; originalHeight: number; zoom?: number }

function Principal() {
  const [settings, setSettings] = useState<Settings>({})
  const [characters, setCharacters] = useState<CharacterItem[]>([])
  const [selectedChar, setSelectedChar] = useState<string>('')
  const [mods, setMods] = useState<ModItem[]>([])
  const [isLoadingMods, setIsLoadingMods] = useState(false)
  const [modImgSrcs, setModImgSrcs] = useState<Record<string, string>>({})
  const [modInternalNames, setModInternalNames] = useState<Record<string, string>>({})
  const [modPageUrls, setModPageUrls] = useState<Record<string, string>>({})
  const [charImgSrcs, setCharImgSrcs] = useState<Record<string, string>>({})
  const [charCrops, setCharCrops] = useState<Record<string, CropMeta | undefined>>({})
  const [showUpdatePanel, setShowUpdatePanel] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showAgregar, setShowAgregar] = useState(false)
  const [showEditar, setShowEditar] = useState(false)
  const [showEliminar, setShowEliminar] = useState(false)
  const [showAgregarMod, setShowAgregarMod] = useState(false)
  const [showEliminarMod, setShowEliminarMod] = useState(false)
  const [showEditarMod, setShowEditarMod] = useState(false)
  const [modToEdit, setModToEdit] = useState<ModItem | null>(null)
  const [modToDelete, setModToDelete] = useState<string>('')
  const [pendingMod, setPendingMod] = useState<{ archivePath: string; archiveFileName: string } | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string>('')
  const [showPreview, setShowPreview] = useState(false)
  const readyRef = useRef(false)
  const hasRoot = useMemo(() => !!settings.modsRoot, [settings])
  // In-memory per-character cache (no files, no extra processes)
  type CacheEntry = {
    mods: ModItem[]
    modImgSrcs: Record<string, string>
    modInternalNames: Record<string, string>
    modPageUrls: Record<string, string>
    ts: number
  }
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const MAX_CACHE = 5

  function applyCache(charName: string) {
    const entry = cacheRef.current.get(charName)
    if (!entry) return false
    setMods(entry.mods)
    setModImgSrcs(entry.modImgSrcs)
    setModInternalNames(entry.modInternalNames)
    setModPageUrls(entry.modPageUrls)
    // touch LRU timestamp
    entry.ts = Date.now()
    cacheRef.current.set(charName, entry)
    return true
  }

  function writeCache(charName: string, entry: Omit<CacheEntry, 'ts'>) {
    cacheRef.current.set(charName, { ...entry, ts: Date.now() })
    // Enforce simple LRU by timestamp
    if (cacheRef.current.size > MAX_CACHE) {
      let oldestKey: string | null = null
      let oldestTs = Number.POSITIVE_INFINITY
      for (const [k, v] of cacheRef.current.entries()) {
        if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k }
      }
      if (oldestKey) cacheRef.current.delete(oldestKey)
    }
  }

  useEffect(() => {
    window.api.getSettings().then((s) => setSettings(s))
  }, [])

  useEffect(() => {
    if (!hasRoot) return
    refreshCharacters()
  }, [hasRoot])

  useEffect(() => {
    if (!selectedChar || !hasRoot) return
    // If we have cache for this character, hydrate immediately to avoid blank flicker
    const hadCache = applyCache(selectedChar)
    if (!hadCache) {
      // No cache yet: clear to avoid showing stale data
      setMods([])
      setModImgSrcs({})
      setModInternalNames({})
      setModPageUrls({})
      setIsLoadingMods(true)
    }
    // Guard against race conditions: capture a load identifier
    const loadId = Date.now()
    ;(async () => {
      await refreshMods(selectedChar, loadId)
    })()
  }, [selectedChar, hasRoot])

  async function refreshCharacters() {
    const list = await window.api.listCharactersWithImages()
    setCharacters(list)
    if (list.length && !selectedChar) {
      setSelectedChar(list[0].name)
    }
    // Load data URLs for images to avoid file:// restrictions in dev server
    const entries = await Promise.all(list.map(async (c) => {
      if (!c.imagePath) return [c.name, ''] as const
      const dataUrl = await window.api.readImageAsDataUrl(c.imagePath)
      return [c.name, dataUrl || ''] as const
    }))
    const map: Record<string, string> = {}
    for (const [name, src] of entries) { if (src) map[name] = src }
    setCharImgSrcs(map)

    // Load crop metadata per character
    const cropEntries = await Promise.all(list.map(async (c) => {
      try {
        const info = await window.api.getCharacterInfo(c.name)
        return [c.name, info.crop as CropMeta | undefined] as const
      } catch {
        return [c.name, undefined] as const
      }
    }))
    const cropMap: Record<string, CropMeta | undefined> = {}
    for (const [name, crop] of cropEntries) { cropMap[name] = crop }
    setCharCrops(cropMap)
  }

  const latestLoadRef = useRef<number>(0)
  async function refreshMods(characterFolder: string, loadId?: number) {
    if (loadId) latestLoadRef.current = loadId
    const list = await window.api.listMods(characterFolder)
    // If another load started after this one, abort applying results
    if (loadId && loadId !== latestLoadRef.current) return
    // active mods first
    list.sort((a: any, b: any) => {
      const ae = a?.meta?.enabled ? 1 : 0
      const be = b?.meta?.enabled ? 1 : 0
      if (ae !== be) return be - ae
      return (a.folder || '').localeCompare(b.folder || '', undefined, { sensitivity: 'base' })
    })
    setMods(list)
    // Incremental loading with limited concurrency to reduce I/O spikes
    const CONCURRENCY = 4
    // Local maps so we can write cache at the end, while updating UI progressively
    const imgMap: Record<string, string> = {}
    const namesMap: Record<string, string> = {}
    const urlsMap: Record<string, string> = {}

    // Prime state with empty maps (or keep existing if we had cache)
    // We won't clear existing maps here to avoid flicker; we'll merge updates progressively

    const tasks = list.map((m) => async () => {
      const key = m.dir + '::' + m.folder
      if (loadId && loadId !== latestLoadRef.current) return
      // 1) Preview image
      try {
        let dataUrl = ''
        if (!m.meta.image) {
          dataUrl = (await window.api.getModPreviewDataUrl(characterFolder, m.folder)) || ''
        } else {
          const abs = `${m.dir.replace(/\\/g, '/')}/${m.meta.image}`
          dataUrl = (await window.api.readImageAsDataUrl(abs)) || ''
        }
        if (dataUrl) {
          imgMap[key] = dataUrl
          if (!loadId || loadId === latestLoadRef.current) {
            setModImgSrcs((prev) => (prev[key] ? prev : { ...prev, [key]: dataUrl }))
          }
        }
      } catch {}
      if (loadId && loadId !== latestLoadRef.current) return
      // 2) Internal name
      try {
        const n = (await window.api.getPrimaryInternalName(characterFolder, m.folder)) || ''
        if (n) {
          namesMap[key] = n
          if (!loadId || loadId === latestLoadRef.current) {
            setModInternalNames((prev) => (prev[key] ? prev : { ...prev, [key]: n }))
          }
        }
      } catch {}
      if (loadId && loadId !== latestLoadRef.current) return
      // 3) Page URL
      try {
        const d = await window.api.getModData(characterFolder, m.folder)
        const url = d?.pageUrl || ''
        if (url) {
          urlsMap[key] = url
          if (!loadId || loadId === latestLoadRef.current) {
            setModPageUrls((prev) => (prev[key] ? prev : { ...prev, [key]: url }))
          }
        }
      } catch {}
    })

    async function runLimited(fns: Array<() => Promise<void>>, limit: number) {
      let idx = 0
      const workers = Array(Math.min(limit, fns.length)).fill(0).map(async () => {
        while (idx < fns.length) {
          const cur = idx++
          await fns[cur]()
        }
      })
      await Promise.all(workers)
    }

    await runLimited(tasks, CONCURRENCY)
    if (loadId && loadId !== latestLoadRef.current) return

    // Final cache write-through with full maps
    writeCache(characterFolder, {
      mods: list,
      modImgSrcs: { ...modImgSrcs, ...imgMap },
      modInternalNames: { ...modInternalNames, ...namesMap },
      modPageUrls: { ...modPageUrls, ...urlsMap },
    })
    if (!loadId || loadId === latestLoadRef.current) setIsLoadingMods(false)

    if (!readyRef.current) {
      try { window.api.notifyReady() } catch {}
      readyRef.current = true
    }
  }

  async function refreshAll() {
    const chars = await window.api.listCharactersWithImages()
    setCharacters(chars)
    // Purge cache entries for removed characters
    const valid = new Set(chars.map(c => c.name))
    for (const key of Array.from(cacheRef.current.keys())) {
      if (!valid.has(key)) cacheRef.current.delete(key)
    }
    // Also rebuild image data URLs for preview
    const entries = await Promise.all(chars.map(async (c) => {
      if (!c.imagePath) return [c.name, ''] as const
      const dataUrl = await window.api.readImageAsDataUrl(c.imagePath)
      return [c.name, dataUrl || ''] as const
    }))
    const map: Record<string, string> = {}
    for (const [name, src] of entries) { if (src) map[name] = src }
    setCharImgSrcs(map)

    // Refresh crop metadata
    const cropEntries = await Promise.all(chars.map(async (c) => {
      try {
        const info = await window.api.getCharacterInfo(c.name)
        return [c.name, info.crop as CropMeta | undefined] as const
      } catch {
        return [c.name, undefined] as const
      }
    }))
    const cropMap: Record<string, CropMeta | undefined> = {}
    for (const [name, crop] of cropEntries) { cropMap[name] = crop }
    setCharCrops(cropMap)

    let cur = selectedChar
    const names = chars.map(c => c.name)
    if (!cur || !names.includes(cur)) cur = names[0] || ''
    setSelectedChar(cur)
  if (cur) await refreshMods(cur)
  else { setMods([]); setModImgSrcs({}) }
  }

  async function pickRoot() {
    const folder = await window.api.selectFolder()
    if (!folder) return
    const s = await window.api.setModsRoot(folder)
    // Root changed => clear caches completely
    cacheRef.current.clear()
    setSettings(s)
  }

  async function addMod() {
    if (!selectedChar) return
    const archive = await window.api.selectArchive()
    if (!archive) return
    // Copy archive into a new mod folder named after archive
  setPendingMod({ archivePath: archive, archiveFileName: archive.split(/[/\\]/).pop() || 'mod.zip' })
  setShowAgregarMod(true)
  }

  async function editMeta(mod: ModItem) {
    setModToEdit(mod)
    setShowEditarMod(true)
  }

  async function removeMod(mod: ModItem) {
    // Open modal instead of inline confirm
    setModToDelete(mod.folder)
    setShowEliminarMod(true)
  }

  // removed per UI change: no standalone update button

  useEffect(() => {
    if (!hasRoot) return
    const debounced = debounce(() => { refreshAll() }, 400)
    const off = window.api.onFsChanged(() => debounced())
    return () => { try { off() } catch {} }
  }, [hasRoot, selectedChar])

  const header = (
    <header className="header">
  <div className="title">Mod Manager by Syleaf</div>
      <div className="update-wrapper"><button onClick={() => setShowUpdatePanel(v => !v)} title="Actualizar">↻ Actualizar</button>{showUpdatePanel && (
        <Actualizar
          onAfterAction={refreshAll}
          onClose={() => setShowUpdatePanel(false)}
        />
      )}</div>
      <div className="update-wrapper"><button onClick={() => setShowConfig(true)} title="Configuración">⚙</button></div>
      <div className="spacer" />
      <div className="root">
        <span className="label">Carpeta de mods:</span>
        <span className="path">{settings.modsRoot || 'No seleccionada'}</span>
        <button onClick={pickRoot}>Cambiar…</button>
      </div>
    </header>
  )

  if (!hasRoot) {
    return (
      <div className="empty">
        {header}
        <main className="center">
          <p>Selecciona una carpeta raíz donde cada subcarpeta será un personaje.</p>
          <button onClick={pickRoot}>Elegir carpeta…</button>
        </main>
      </div>
    )
  }

  return (
    <div className="layout layout-2">
      {header}
      {/* Subencabezados separados (no dentro de los scrollers) */}
      <div className="panel-header subheader-left">
        <h2>Personajes</h2>
        <div className="spacer" />
        <button onClick={() => setShowAgregar(true)} title="Agregar personaje">+ Agregar</button>
        <button onClick={() => setShowEditar(true)} title="Editar personaje">✎ Editar</button>
        <button className="danger" onClick={() => setShowEliminar(true)} title="Eliminar personaje" disabled={!selectedChar}>✖ Eliminar</button>
        {/* Character enable/disable removed */}
      </div>
      <div className="panel-header subheader-right">
        <h3>Mods</h3>
        <div className="spacer" />
  <button onClick={addMod} disabled={!selectedChar}>+ Agregar Mod (ZIP/7z/RAR)</button>
      </div>

      {/* Izquierda: Personajes */}
      <main className="characters-panel">
        <div className="characters-grid">
          {characters.map((c) => (
            <div
              key={c.name}
              className={`char-card ${c.name === selectedChar ? 'active' : ''}`}
              onClick={() => setSelectedChar(c.name)}
            >
              {charImgSrcs[c.name] ? (
                (() => {
                  const crop = charCrops[c.name]
                  const baseStyle: any = { width: 'var(--char-thumb-width)', height: 'var(--char-thumb-height)', borderRadius: 0, overflow: 'visible', backgroundColor: '#0e1320' }
                  if (crop && crop.originalWidth > 0 && crop.originalHeight > 0 && crop.width > 0 && crop.height > 0) {
                    const varW = getComputedStyle(document.documentElement).getPropertyValue('--char-thumb-width')
                    const varH = getComputedStyle(document.documentElement).getPropertyValue('--char-thumb-height')
                    const containerW = parseFloat(varW) || 180
                    const containerH = parseFloat(varH) || 135
                    // scale so that the crop area fits exactly the container (keep decimals for precision)
                    const scaleX = containerW / crop.width
                    const scaleY = containerH / crop.height
                    const scale = Math.max(scaleX, scaleY) || 1
                    const bgW = crop.originalWidth * scale
                    const bgH = crop.originalHeight * scale
                    // center-based positioning: align crop center to container center
                    const cx = crop.x + crop.width / 2
                    const cy = crop.y + crop.height / 2
                    const posX = containerW / 2 - (cx * scale)
                    const posY = containerH / 2 - (cy * scale)
                    return (
                      <div
                        className="char-thumb"
                        style={{
                          ...baseStyle,
                          backgroundImage: `url(${charImgSrcs[c.name]})`,
                          backgroundRepeat: 'no-repeat',
                          backgroundSize: `${bgW}px ${bgH}px`,
                          backgroundPosition: `${posX}px ${posY}px`,
                        }}
                      />
                    )
                  }
                  // Fallback: centered cover
                  return (
                    <div
                      className="char-thumb"
                      style={{
                        ...baseStyle,
                        backgroundImage: `url(${charImgSrcs[c.name]})`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: 'cover',
                        backgroundPosition: '50% 50%'
                      }}
                    />
                  )
                })()
              ) : (
                <div className="char-avatar">{c.name.charAt(0).toUpperCase()}</div>
              )}
              <div className="char-name">{c.name}</div>
            </div>
          ))}
          {characters.length === 0 && (
            <div className="empty-hint">No hay personajes. Crea carpetas dentro de la raíz para cada personaje.</div>
          )}
        </div>
      </main>

      {/* Derecha: Mods del personaje seleccionado */}
      <section className="mods-panel">
        {!selectedChar && <div className="empty-hint">Selecciona un personaje a la izquierda.</div>}
        {selectedChar && (
          <div className="mods-grid">
            {isLoadingMods && mods.length === 0 && (
              <div className="loading-state">
                <div className="spinner" />
                <div>Cargando mods…</div>
              </div>
            )}
            {mods.map((m) => (
              <div key={m.folder} className="mod-card">
                <div className="mod-thumb" onClick={() => { const key = m.dir + '::' + m.folder; if (modImgSrcs[key]) { setPreviewSrc(modImgSrcs[key]); setShowPreview(true) } }}>
                  {(() => { const key = m.dir + '::' + m.folder; const src = modImgSrcs[key]; return src ? (
                    <div style={{ width: '100%', height: '100%', backgroundImage: `url(${src})`, backgroundRepeat: 'no-repeat', backgroundSize: 'cover', backgroundPosition: '50% 50%' }} />
                  ) : (
                    <div className="placeholder">Sin imagen</div>
                  ) })()}
                </div>
                <div className="mod-info">
                  <div className="mod-name">{modInternalNames[m.dir + '::' + m.folder] || m.meta.name || m.folder}</div>
                  <div className="muted" title={m.folder}>{m.folder}</div>
                  {(() => { const url = modPageUrls[m.dir + '::' + m.folder]; return url ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); window.api.openModPage(selectedChar, m.folder) }} title={url}>
                      {url}
                    </a>
                  ) : <div className="muted">Sin URL</div> })()}
                </div>
                <div className="mod-actions">
                  <button onClick={() => editMeta(m)}>Editar</button>
                  <button onClick={() => window.api.openFolder(selectedChar, m.folder)}>Carpeta</button>
                  {m.meta.enabled ? (
                    <button onClick={async () => { cacheRef.current.delete(selectedChar); await window.api.disableMod(selectedChar, m.folder); await refreshMods(selectedChar) }}>Desactivar</button>
                  ) : (
                    <button onClick={async () => { cacheRef.current.delete(selectedChar); await window.api.enableMod(selectedChar, m.folder); await refreshMods(selectedChar) }}>Activar</button>
                  )}
                  <button className="danger" onClick={() => removeMod(m)}>Eliminar</button>
                </div>
              </div>
            ))}
            {mods.length === 0 && <div className="empty-hint">No hay mods para este personaje todavía.</div>}
          </div>
        )}
      </section>

      {showConfig && (
        <Configuracion
          onClose={() => setShowConfig(false)}
          onSettingsChanged={async (s) => {
            const prevRoot = settings.modsRoot
            setSettings(s)
            if (s.modsRoot !== prevRoot) {
              cacheRef.current.clear()
              await refreshAll()
            }
          }}
        />
      )}
      {showAgregar && (
        <Agregar
          onClose={() => setShowAgregar(false)}
          onAdded={async (name) => {
            // Ensure we select the new character after adding
            await refreshAll()
            setSelectedChar(name)
          }}
        />
      )}
      {showEditar && selectedChar && (
        <Editar
          currentName={selectedChar}
          onClose={() => setShowEditar(false)}
          onUpdated={async (newName) => {
            // Rename: move cache entry to new key if present
            const old = cacheRef.current.get(selectedChar)
            if (old) {
              cacheRef.current.delete(selectedChar)
              cacheRef.current.set(newName, { ...old, ts: Date.now() })
            }
            await refreshAll()
            setSelectedChar(newName)
          }}
        />
      )}
      {showAgregarMod && selectedChar && pendingMod && (
        <AgregarMod
          character={selectedChar}
          archivePath={pendingMod.archivePath}
          archiveFileName={pendingMod.archiveFileName}
          onClose={() => { setShowAgregarMod(false); setPendingMod(null) }}
          onSaved={async () => {
            // Invalidate cache for this character and refresh
            cacheRef.current.delete(selectedChar)
            await refreshMods(selectedChar)
          }}
        />
      )}
      {showEliminarMod && selectedChar && modToDelete && (
        <EliminarMod
          character={selectedChar}
          modName={modToDelete}
          onClose={() => { setShowEliminarMod(false); setModToDelete('') }}
          onDeleted={async () => {
            cacheRef.current.delete(selectedChar)
            await refreshMods(selectedChar)
          }}
        />
      )}
      {showEditarMod && selectedChar && modToEdit && (
        <EditarMod
          character={selectedChar}
          mod={modToEdit}
          onClose={() => { setShowEditarMod(false); setModToEdit(null) }}
          onSaved={async () => {
            cacheRef.current.delete(selectedChar)
            await refreshMods(selectedChar)
          }}
        />
      )}
      {showEliminar && selectedChar && (
        <Eliminar
          character={selectedChar}
          onClose={() => setShowEliminar(false)}
          onDeleted={async () => {
            cacheRef.current.delete(selectedChar)
            await refreshAll()
          }}
        />
      )}
      {showPreview && (
        <div className="overlay" onClick={() => setShowPreview(false)}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            {previewSrc ? (
              <>
                <img className="preview-img" src={previewSrc} alt="Vista previa" />
                <button className="preview-close" onClick={() => setShowPreview(false)}>×</button>
              </>
            ) : (
              <div className="placeholder">Sin imagen</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function debounce<T extends (...args: any[]) => void>(fn: T, wait = 400) {
  let t: any
  return (...args: any[]) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}

export default Principal
