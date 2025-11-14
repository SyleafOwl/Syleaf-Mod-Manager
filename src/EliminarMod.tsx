import { useEffect, useRef } from 'react'

type Props = {
  character: string
  modName: string
  onClose: () => void
  onDeleted?: () => void | Promise<void>
}

export default function EliminarMod({ character, modName, onClose, onDeleted }: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null)

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

  async function handleDelete() {
    try {
      await window.api.deleteMod(character, modName)
      await onDeleted?.()
    } finally {
      onClose()
    }
  }

  return (
    <div className="overlay">
      <div ref={modalRef} className="modal">
        <div className="modal-header">
          <div className="modal-title">Eliminar mod</div>
          <button className="icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 600, color: '#ffacac' }}>Advertencia</div>
            <div className="muted">Se eliminará únicamente este mod del personaje, incluyendo:</div>
            <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
              <li>El archivo ZIP/7z/RAR copiado en la carpeta del mod.</li>
              <li>La imagen de vista previa guardada para este mod.</li>
              <li>Los metadatos del mod (por ejemplo, URL de la página y URL/imagen asociada).</li>
            </ul>
            <div>
              Mod a eliminar: <b>{modName}</b> (personaje <b>{character}</b>).
            </div>
            <div className="muted" style={{ fontSize: 12 }}>Esta acción es irreversible y no borra al personaje.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={onClose}>Cancelar</button>
            <button className="danger" onClick={handleDelete}>Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
