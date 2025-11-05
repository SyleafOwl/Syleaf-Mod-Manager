import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'

// Panel to add a new Character folder
// Shows a live image preview from a URL (not persisted),
// a name input for the character folder, and Add/Cancel actions.

type Props = {
  onClose: () => void
  onAdded?: (name: string) => void | Promise<void>
}

export default function Agregar({ onClose, onAdded }: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  // Vista de recorte (un poco más grande que 160x120 para comodidad visual)
  const VIS_W = 360
  const VIS_H = 270
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imgOk, setImgOk] = useState(true)
  const [srcDataUrl, setSrcDataUrl] = useState<string>('')
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<{ width: number; height: number; x: number; y: number } | null>(null)

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

  // Debounced load of URL as a data URL (to avoid CORS tainting)
  useEffect(() => {
    const u = imageUrl.trim()
    if (!u) { setSrcDataUrl(''); setImgOk(true); return }
    const t = setTimeout(async () => {
      try {
        const data = await window.api.fetchImageDataUrl(u)
        setSrcDataUrl(data)
        setImgOk(true)
      } catch {
        setImgOk(false)
        setSrcDataUrl('')
      }
    }, 400)
    return () => clearTimeout(t)
  }, [imageUrl])

  const onCropComplete = useCallback(async (_area: any, areaPixels: any) => {
    setCroppedArea(areaPixels)
  }, [])

  // Build crop metadata using the original image size (we will save the full image)
  async function buildCropMeta(imageSrc: string, area: { x: number; y: number; width: number; height: number }) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = imageSrc
    })
    return { x: area.x, y: area.y, width: area.width, height: area.height, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, zoom }
  }

  async function handleAdd() {
    const n = name.trim()
    if (!n) return
    try {
      // Create mods folder
      await window.api.addCharacter(n)
      // Save image (FULL image; crop meta is stored in the .txt)
      const u = imageUrl.trim()
      try {
        if (srcDataUrl && croppedArea) {
          const crop = await buildCropMeta(srcDataUrl, croppedArea)
          await window.api.saveImageFromDataUrl(n, srcDataUrl, u || undefined, crop)
        } else if (u) {
          await window.api.saveImageFromUrl(n, u)
        }
      } catch (e: any) {
        alert('Se creó la carpeta del personaje, pero no se pudo guardar la imagen.\n' + (e?.message || e))
      }
      await onAdded?.(n)
    } finally {
      onClose()
    }
  }

  // Removed explicit download/save triggers; saving happens on Agregar

  return (
    <div className="overlay">
      <div ref={modalRef} className="modal">
        <div className="modal-header">
          <div className="modal-title">Agregar Personaje</div>
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
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>Sin vista previa</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: 200 }} />
            </div>
            <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Recuadro 4:3 (mismo aspecto que Personajes). Puedes desplazar y ampliar.</div>
          </div>
          {/* Name input */}
          <div className="field-row">
            <div className="label">Nombre de carpeta</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Soldier 11"
            />
          </div>
          {/* Image URL input (se guarda junto a la imagen recortada) */}
          <div className="field-row">
            <div className="label">URL de imagen</div>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://.../icon.png"
              className="input-url"
            />
          </div>
          {!imgOk && imageUrl && (
            <div className="muted" style={{ color: '#d66', marginTop: 4 }}>No se pudo cargar la imagen desde la URL.</div>
          )}
          {/* No Enter-to-save hint; se guarda junto a un .txt en DataBase al Agregar */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={onClose}>Cancelar</button>
            <button onClick={handleAdd} disabled={!name.trim()}>Agregar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
