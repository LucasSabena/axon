# Dropbox en Archivos

Dropbox aparece como una ubicación remota junto a Servidor. Navegar consulta nombres y metadatos; abrir un archivo trae su contenido bajo demanda. No se sincroniza toda la cuenta ni se instala un montaje rclone. La conexión solicita exclusivamente lectura.

## Configuración inicial

1. Abrí **Archivos → Dropbox → Configurar conexión**.
2. Creá una aplicación en https://www.dropbox.com/developers/apps con **Scoped access** y **Full Dropbox**. App Folder no permite explorar las carpetas existentes de tu cuenta.
3. Habilitá `account_info.read`, `files.metadata.read`, `files.content.read` y `sharing.read` en Permissions y guardá.
4. Registrá la Redirect URI que muestra AXON, exactamente, en OAuth 2. El servidor detrás de un proxy debe configurar `AXON_PUBLIC_ORIGIN` con su origen público. El despliegue actual ya usa `https://axon.example.com`.
5. Guardá la **App key** en AXON y pulsá **Conectar Dropbox**. La contraseña se ingresa en Dropbox. No se necesita pegar el App secret: el flujo usa OAuth authorization code con PKCE y refresh tokens.

Opcionalmente, el administrador puede configurar `DROPBOX_CLIENT_ID` en el entorno del servidor. En ese caso el campo no se edita en la interfaz. La autorización pertenece al usuario de AXON; cada cuenta conectada y sus enlaces se aíslan por usuario.

## Uso

- Navegá carpetas, filtrá la carpeta actual o cargá la siguiente página. El filtro no busca en toda la cuenta.
- Abrí imágenes, audio/video que el navegador soporte, PDF o texto. HTML y SVG no se sirven como contenido activo del origen de AXON. La vista de texto se limita a los primeros 512 KiB.
- Agregá enlaces compartidos después de conectar una cuenta. Los permisos del enlace siguen aplicando. Esto no convierte un enlace de lectura en una carpeta compartida editable.
- Seleccioná archivos/carpetas y elegí **Guardar en un disco**. El selector muestra discos, rutas y espacio observado; permite navegar o crear una carpeta. El backend vuelve a validar el disco y sus permisos.
- La copia sigue aunque cierres la pestaña, muestra progreso y se puede cancelar. **Abrir carpeta del servidor** permite ver el resultado.
- Desconectar revoca el acceso local, intenta revocar el token en Dropbox y cancela copias activas. Conserva las copias locales completas.

## Integridad y recuperación

Las credenciales y las URLs de enlaces se cifran con AES-256-GCM. La clave está en `data/cloud/vault.key`, con permisos privados; el estado cifrado y el historial de trabajos están en `data/platform/platform.sqlite`. Los respaldos deben conservar ambos. No se exponen tokens ni URLs privadas en el estado enviado al navegador.

El worker escribe como el usuario del host, recorre directorios con descriptores y `O_NOFOLLOW`, verifica el tamaño y el hash de Dropbox cuando está disponible, y publica cada elemento raíz con `renameat2(RENAME_NOREPLACE)`. Nunca reemplaza un archivo, directorio o enlace existente. Los archivos `.env` usan permisos 600. Cada carpeta seleccionada se publica completa; una selección de múltiples elementos no constituye una transacción atómica conjunta.

Una cancelación durante la publicación puede dejar algunos elementos completos guardados. Un reinicio marca los trabajos del proceso anterior como interrumpidos y no los repite. Un cierre forzado puede dejar una carpeta privada `.axon-dropbox-<id>` en el destino original: revisá el trabajo y el destino antes de reintentar; no se elimina contenido automáticamente en el siguiente arranque.

Se admite una copia activa por usuario, hasta 100 selecciones y 50.000 elementos por copia. Documentos que Dropbox marca como no descargables requieren exportarlos desde Dropbox. El acceso remoto necesita Internet y está sujeto a límites y permisos de Dropbox.

## Validación

`pnpm run check`, `pnpm run build`, `pnpm run test src/cloud/dropbox.test.ts`.

Las pruebas del backend usan respuestas Dropbox inyectadas y el worker real sobre directorios temporales. `scripts/dropbox-browser-qa.cjs`, ejecutado con `playwright-cli run-code --filename=...` contra el QA aislado, prueba la interfaz con respuestas Dropbox simuladas y navegación/creación de carpetas reales en la fixture. No sustituye la autorización y verificación con una cuenta real.

Fuentes: [OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth), [acceso a archivos](https://docs.dropboxapi.com/dropbox-api/docs/file-access), [SDK oficial](https://dropbox.github.io/dropbox-sdk-js/Dropbox.html), [referencia de explorador de 21st](https://21st.dev/@extend-hq/components/file-system).
