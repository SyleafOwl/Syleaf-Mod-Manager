import { useEffect, useRef, useState } from 'react'

// Panel to add a new Character folder
// Shows a live image preview from a URL (not persisted),
// a name input for the character folder, and Add/Cancel actions.

type Props = {
  onClose: () => void
  onAdded?: (name: string) => void | Promise<void>
}

export default function Agregar({ onClose, onAdded }: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imgOk, setImgOk] = useState(true)
  const [previewSrc, setPreviewSrc] = useState('')

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = e.target as HTMLElement
      if (!modalRef.current) return
      if (!modalRef.current.contains(el)) onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [onClose])

  async function handleAdd() {
    const n = name.trim()
    if (!n) return
    try {
      await window.api.addCharacter(n)
      await onAdded?.(n)
    } finally {
      onClose()
    }
  }

  async function downloadAndPreview() {
    const n = name.trim()
    const u = imageUrl.trim()
    if (!n) { alert('Primero escribe el nombre del personaje.'); return }
    if (!u) { alert('Ingresa una URL válida.'); return }
    try {
      const saved = await window.api.saveImageFromUrl(n, u)
      const data = await window.api.readImageAsDataUrl(saved)
      if (data) setPreviewSrc(data)
      setImgOk(true)
    } catch (e: any) {
      alert('No se pudo descargar o guardar la imagen. Revisa la Carpeta de Imágenes en Configuración.\n' + (e?.message || e))
      setImgOk(false)
    }
  }

  return (
    <div className="overlay">
      <div ref={modalRef} className="modal">
        <div className="modal-header">
          <div className="modal-title">Agregar Personaje</div>
          <button className="icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Image preview (only visualization) */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {previewSrc || imageUrl ? (
              <img
                src={previewSrc || imageUrl}
                onError={() => setImgOk(false)}
                onLoad={() => setImgOk(true)}
                alt="Vista previa"
                style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, border: '1px solid #3333' }}
              />
            ) : (
              <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid #3333', color: '#999' }}>
                Sin vista previa
              </div>
            )}
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
          {/* Image URL input (only for preview) */}
          <div className="field-row">
            <div className="label">URL de imagen (solo vista)</div>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') downloadAndPreview() }}
              placeholder="https://.../icon.png"
              className="input-url"
            />
            <button onClick={downloadAndPreview} title="Descargar y guardar">Guardar</button>
          </div>
          {!imgOk && imageUrl && (
            <div className="muted" style={{ color: '#d66', marginTop: 4 }}>No se pudo cargar la imagen desde la URL.</div>
          )}
          <div className="muted" style={{ fontSize: 12 }}>Consejo: Presiona Enter en el campo de URL para descargar y guardar en tu Carpeta de Imágenes.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={onClose}>Cancelar</button>
            <button onClick={handleAdd} disabled={!name.trim()}>Agregar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
