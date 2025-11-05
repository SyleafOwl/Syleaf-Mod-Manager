import { useEffect, useState } from 'react'

type Settings = { modsRoot?: string; imagesRoot?: string }

type Props = {
  // Optional notify to parent when settings changed
  onSettingsChanged?: (settings: Settings) => void
  onClose: () => void
}

export default function Configuracion({ onSettingsChanged, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>({})

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('.modal')) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  useEffect(() => {
    // Load current settings when modal opens
    window.api.getSettings().then((s) => setSettings(s))
  }, [])

  async function changeModsRoot() {
    const folder = await window.api.selectFolder()
    if (!folder) return
    const newSettings = await window.api.setModsRoot(folder)
    setSettings(newSettings)
    onSettingsChanged?.(newSettings)
  }

  async function changeImagesRoot() {
    const folder = await window.api.selectFolder()
    if (!folder) return
    const newSettings = await window.api.setImagesRoot(folder)
    setSettings(newSettings)
    onSettingsChanged?.(newSettings)
  }

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Configuración</div>
          <button className="icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <div className="label">Carpeta de Mods</div>
            <div className="path">{settings.modsRoot || 'No seleccionada'}</div>
            <button onClick={changeModsRoot}>Cambiar…</button>
          </div>
          <div className="field-row">
            <div className="label">Carpeta DataBase</div>
            <div className="path">{settings.imagesRoot || 'No seleccionada'}</div>
            <button onClick={changeImagesRoot}>Cambiar…</button>
          </div>
          <hr />
          <div className="made-by">Hecho por Syleaf</div>
        </div>
      </div>
    </div>
  )
}
