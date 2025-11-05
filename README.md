# Mod Manager by Syleaf

Administrador de mods para Zenless Zone Zero. Sencillo, por personaje, sin ejecutar el juego, hecho con Electron + React + TypeScript.

## ¿Qué hace?

Te ayuda a organizar y mantener tus mods por personaje:

- Cada personaje es una carpeta dentro de tu raíz de mods (configurable).
- Cada mod es una subcarpeta dentro del personaje.
- Puedes agregar, editar y eliminar mods sin tocar el juego.
- Las imágenes se muestran bien encuadradas en la UI sin recortar archivos físicamente.

## Características principales

- Raíces configurables
	- modsRoot: dónde viven los personajes y sus mods.
	- imagesRoot: "DataBase" por personaje (imagen del personaje y metadatos en `<Personaje>.txt`).

- Gestión por personaje
	- Listado con miniaturas. Las imágenes de personaje se guardan completas y se conserva un recorte lógico (crop) para la vista; el recorte no modifica el archivo.
	- Normalización y renombrado de personajes con manejo especial para cambios de mayúsculas/minúsculas en Windows.

- Gestión de mods
	- Agregar Mod: copia el archivo .zip/.7z/.rar a una nueva carpeta del mod (no se extrae automáticamente). Permite indicar URL del mod y URL de imagen; puedes previsualizar la imagen antes de guardar.
	- Editar Mod: cambia la URL del mod y la URL de imagen; vista previa sin recorte. Guarda la vista previa en la carpeta del mod y actualiza `mod.json`.
	- Eliminar Mod: solo borra la carpeta de ese mod (incluyendo preview y metadatos). No afecta al personaje.

- Sincronización con DataBase del personaje
	- Por cada personaje se mantiene `<Personaje>.txt` en `imagesRoot/<Personaje>/` con:
		- `url` (opcional) e `crop` (opcional) de la imagen del personaje.
		- `mods[]` con entradas `{ name, pageUrl?, imageUrl?, imageFile? }`.
	- Al agregar un mod, se añade una entrada a `mods[]` y opcionalmente se guarda una imagen como `<Personaje>MOD<N>.*`.
	- Al editar un mod, además de `mod.json` y la preview del mod, se sincronizan `pageUrl` e `imageUrl` dentro de `mods[]`.

- Detalles técnicos
	- Electron (main + preload) con IPC tipado y seguro.
	- Renderer con React + Vite + TypeScript.
	- Las imágenes se cargan como Data URL para evitar problemas `file://` durante el desarrollo.
	- Watcher de sistema de archivos para refrescar la UI al detectar cambios.

## Cómo organiza tus archivos

```
modsRoot/
	<Personaje>/
		<Mod A>/
			mod.json
			preview.png (opcional)
			<archivo-original>.zip (copiado al agregar)
		<Mod B>/
imagesRoot/
	<Personaje>/
		<Personaje>.png|jpg|webp (imagen principal)
		<Personaje>.txt               (JSON con url/crop y mods[])
		<Personaje>MOD1.png|jpg|webp  (opcional, si guardas imagen del mod en DataBase)
```

Notas:
- Las miniaturas de mods usan "cover" en CSS (encuadre visual). No se guarda un recorte físico de la imagen.
- La imagen del personaje se guarda completa; el "recorte" es solo metadato para la UI.

## Flujo de trabajo

1) Agregar Mod
- Seleccionas un archivo .zip/.7z/.rar.
- El archivo se copia a una carpeta nueva del mod.
- Puedes indicar la URL del mod y la URL de imagen. Pulsa Enter en la URL de imagen para previsualizar.
- Al guardar: se escribe `mod.json`, se guarda la preview en la carpeta del mod y se añade/actualiza la entrada en `imagesRoot/<Personaje>/<Personaje>.txt`.

2) Editar Mod
- Vista previa sin recorte; puedes actualizar la URL del mod y la URL de imagen.
- Al guardar: se actualiza `mod.json`, la preview del mod y se sincronizan `pageUrl` e `imageUrl` en `mods[]` del DataBase del personaje.

3) Eliminar Mod
- Solo elimina la carpeta de ese mod y sus archivos relacionados (preview, `mod.json`, el archivo comprimido copiado). No borra al personaje ni otros mods.

## Instalación y desarrollo

Requisitos: Node.js 18+

1) Instalar dependencias

```
npm install
```

2) Ejecutar en desarrollo

```
npm run dev
```

3) Compilar/empacar

```
npm run build
```

## Alcance y límites

- No ejecuta ni modifica el juego; se centra en organizar archivos y metadatos.
- La extracción de archivos comprimidos no es automática al agregar (el ZIP/7z se copia tal cual a la carpeta del mod). Existe soporte para actualización desde `updateUrl` en `mod.json` cuando aplica.

---

Hecho con cariño por Syleaf.

