import { useEffect, useRef, useState } from 'react'

type Props = {
  // Notify parent to refresh its data (characters/mods) after an action
  onAfterAction: () => Promise<void> | void
  onClose: () => void
}

export default function Actualizar({ onAfterAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [loading] = useState(false)

  // Close on click outside
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [onClose])

  async function handleRefreshFolders() {
    // No side-effects here besides telling parent to refresh UI
    await onAfterAction()
    onClose()
  }

  async function handleNormalizeNames() {
    try {
      const res = await window.api.normalizeCharacterNames()
      await onAfterAction()
      if (res.changed.length === 0 && res.skipped.length === 0) {
        alert('No hubo cambios')
      }
    } catch (e: any) {
      alert('No se pudo actualizar los nombres: ' + (e?.message || e))
    } finally {
      onClose()
    }
  }

  return (
    <div className="update-wrapper">
      <div ref={ref} className="update-panel">
        <button disabled={loading} onClick={handleRefreshFolders}>Actualizar Carpetas</button>
        <button disabled={loading} onClick={handleNormalizeNames}>Actualizar Nombres</button>
      </div>
    </div>
  )
}
