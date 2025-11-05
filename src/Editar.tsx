import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'

type Props = {
  currentName: string
  onClose: () => void
  onUpdated?: (newName: string) => void | Promise<void>
}

export default function Editar({ currentName, onClose, onUpdated }: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  // Vista de recorte (un poco más grande que 160x120 para comodidad visual)
  const VIS_W = 240
  const VIS_H = 180
  const [name, setName] = useState(currentName)
  const [imageUrl, setImageUrl] = useState('')
  const [imgOk, setImgOk] = useState(true)
  // Keep a source data URL for cropping (from saved image or fetched URL)
  const [srcDataUrl, setSrcDataUrl] = useState<string>('')
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<{ width: number; height: number; x: number; y: number } | null>(null)
  

  useEffect(() => { setName(currentName) }, [currentName])

  // Load existing DB info (image + url) for this character
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const info = await window.api.getCharacterInfo(currentName)
        if (cancelled) return
        if (info.url) setImageUrl(info.url)
        if (info.imagePath) {
          const data = await window.api.readImageAsDataUrl(info.imagePath)
          if (!cancelled && data) setSrcDataUrl(data)
        }
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [currentName])

  // Manual fetch of URL preview only when pressing Enter (no auto fetch on change)
  async function fetchPreviewFromUrl() {
    const u = imageUrl.trim()
    if (!u) { setImgOk(true); return }
    try {
      const data = await window.api.fetchImageDataUrl(u)
      setSrcDataUrl(data)
      setImgOk(true)
    } catch {
      setImgOk(false)
    }
  }

  const onCropComplete = useCallback(async (_area: any, areaPixels: any) => {
    setCroppedArea(areaPixels)
  }, [])

  // Build crop metadata without cropping the image (we will save the full image)
  async function buildCropMeta(imageSrc: string, area: { x: number; y: number; width: number; height: number }) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = imageSrc
    })
    return { x: area.x, y: area.y, width: area.width, height: area.height, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, zoom }
  }

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (!modalRef.current) return
      if (!modalRef.current.contains(el)) onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  async function handleUpdate() {
    const oldName = currentName
    const newName = name.trim()
    if (!newName) return
    try {
      if (newName !== oldName) {
        await window.api.renameCharacter(oldName, newName)
      }
      const u = imageUrl.trim()
      try {
        if (srcDataUrl && croppedArea) {
          // Save FULL image and persist crop meta in JSON
          const crop = await buildCropMeta(srcDataUrl, croppedArea)
          await window.api.saveImageFromDataUrl(newName, srcDataUrl, u || undefined, crop)
        } else if (u) {
          // Save full image from URL; no crop meta if none chosen
          await window.api.saveImageFromUrl(newName, u)
        }
      } catch (e: any) {
        alert('Se actualizó el nombre, pero no se pudo guardar la imagen.\n' + (e?.message || e))
      }
      await onUpdated?.(newName)
    } finally {
      onClose()
    }
  }

  return (
    <div className="overlay">
      <div ref={modalRef} className="modal">
        <div className="modal-header">
          <div className="modal-title">Editar Personaje</div>
          <button className="icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Crop preview (4:3 like characters grid). Drag to reposition, use slider to zoom */}
          <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <div style={{
              width: VIS_W,
              height: VIS_H,
              maxWidth: 'min(90vw, 420px)',
              maxHeight: 'min(60vh, 320px)',
              position: 'relative',
              background: '#0e1320',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #3333',
            }}>
              {srcDataUrl ? (
                <Cropper
                  image={srcDataUrl}
                  crop={crop}
                  zoom={zoom}
                  aspect={4/3}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                  objectFit="cover"
                  showGrid={false}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>Vista previa</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: 200 }} />
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Recuadro 4:3 (mismo aspecto que Personajes). Puedes desplazar y ampliar.</div>
          </div>
          <div className="field-row">
            <div className="label">Nombre de carpeta</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Soldier 11" />
          </div>
          <div className="field-row">
            <div className="label">URL de imagen (solo vista)</div>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchPreviewFromUrl() }}
              placeholder="https://.../icon.png"
              className="input-url"
            />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Pulsa Enter en el campo URL para cargar la vista previa.</div>
          {!imgOk && imageUrl && (
            <div className="muted" style={{ color: '#d66', marginTop: 4 }}>No se pudo cargar la imagen desde la URL.</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={onClose}>Cancelar</button>
            <button onClick={handleUpdate} disabled={!name.trim()}>Actualizar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
