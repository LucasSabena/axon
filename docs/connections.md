# Conexiones de almacenamiento

Configuración → Conexiones reúne Dropbox, Google Drive y OneDrive. Cada usuario de AXON tiene sus propias aplicaciones, cuentas y preferencias. Archivos muestra sólo cuentas conectadas con **Mostrar en Archivos** activado. Ocultar conserva la conexión; desconectar elimina las credenciales locales y cancela sus copias activas. La visibilidad se guarda en el servidor y sobrevive recargas y cambios de navegador.

Cada plataforma usa autorización OAuth oficial, acceso de lectura, estado de un solo uso ligado a la sesión y PKCE. Los secretos y tokens se guardan con AES-256-GCM en el almacén privado. La contraseña se ingresa en la plataforma. Para una instalación propia hay que registrar una aplicación OAuth; la sección Conexiones incluye las instrucciones y la dirección de retorno exacta. Nunca se devuelve un secreto guardado al navegador.

## Configurar una aplicación

Para una cuenta personal o una herramienta interna Dropbox permite conservar el estado **Development**. No hay que completar **Request production status**, proporcionar cuentas de prueba ni solicitar una revisión de publicación para este uso. [Reglas oficiales de aprobación](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide). El alcance Full Dropbox es independiente del estado Development/Production.

La conexión nativa actual necesita registrar una aplicación una vez por proveedor o preconfigurar sus credenciales en el servidor. Después el usuario sólo pulsa Conectar y autoriza. Una alternativa que evita crear aplicaciones propias es usar los clientes integrados de rclone; su autorización en un servidor remoto exige el flujo local o un túnel descrito en [Remote Setup](https://rclone.org/remote_setup/). Esa alternativa no está implementada en esta versión de AXON.

- **Dropbox:** aplicación Full Dropbox; permisos `account_info.read`, `files.metadata.read`, `files.content.read`, `sharing.read`; App key. [Consola](https://www.dropbox.com/developers/apps).
- **Google Drive:** habilitar Google Drive API; cliente OAuth **Aplicación web**, Client ID y Client secret; configurar consentimiento y usuarios de prueba si corresponde. Permiso `drive.readonly`. [Documentación oficial](https://developers.google.com/identity/protocols/oauth2/web-server).
- **OneDrive:** registro Microsoft Entra para cuentas organizativas y personales; plataforma **Web**, Application ID y valor del secreto de cliente. Permisos delegados `Files.Read`, `User.Read`, `offline_access`. Puede requerir consentimiento del administrador según la organización. [Flujo oficial](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Las direcciones son `<origen público>/api/files/{dropbox,gdrive,onedrive}/oauth/callback`. `AXON_PUBLIC_ORIGIN` fija el origen detrás del proxy. También se puede configurar por entorno con `DROPBOX_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_ID` + `GOOGLE_DRIVE_CLIENT_SECRET`, `ONEDRIVE_CLIENT_ID` + `ONEDRIVE_CLIENT_SECRET`. La interfaz informa si la aplicación viene del servidor y bloquea cambios locales.

## Navegar y guardar

Archivos permite alternar entre **Lista**, **Detalles** (tipo, tamaño y fecha de modificación) y **Cuadrícula**. La vista y el orden se conservan en el navegador y en la dirección de la página, incluida la recarga y la navegación entre carpetas. Se puede ordenar por nombre, tipo, tamaño o modificación, en ambos sentidos; las carpetas aparecen primero. El filtro y la ordenación se aplican a los elementos ya cargados. Si quedan páginas, se informa junto al contador y se cargan con **Cargar más**. Cambiar de vista conserva la selección y no descarga archivos ni vuelve a listar la nube. La cuadrícula muestra iconos por tipo; el contenido se obtiene al abrir la vista previa.

El indicador **Sólo lectura** describe las operaciones disponibles en AXON: abrir y copiar al disco. Subir, editar, renombrar, mover y borrar contenido remoto no están implementados. Habilitarlos exigiría agregar esas operaciones y volver a autorizar los permisos de escritura correspondientes; cambiar la vista no modifica permisos.

Listar carpetas consulta metadatos. La vista previa trae sólo el archivo abierto; audio y video usan rangos. Google Drive y OneDrive navegan por identificadores remotos para distinguir nombres repetidos. Los documentos nativos de Google Workspace y sus accesos directos se abren en Google Drive; deben exportarse allí antes de copiarlos a un disco. Esta versión navega Mi unidad / Mi OneDrive; no incluye exploradores independientes de unidades compartidas ni bibliotecas de SharePoint. Dropbox conserva sus enlaces compartidos guardados. Las aplicaciones Dropbox de tipo App Folder se detectan al listar y se exploran sin Path-Root; la interfaz avisa que sólo ven la carpeta propia de la aplicación y explica cómo conectar una aplicación Full Dropbox para ver toda la cuenta.

Guardar en un disco usa el mismo selector de volúmenes y carpetas del servidor. Congela versión y tamaño, valida identidad del disco, verifica el hash disponible (Dropbox content hash, Google MD5 o OneDrive SHA1) y publica cada raíz sin reemplazar nada existente. Las carpetas vacías se conservan. Una operación puede publicar varias raíces completas antes de interrumpirse; los recibos indican cuáles. Al reiniciar AXON, las copias pendientes quedan interrumpidas y no se repiten automáticamente. Un cierre forzado puede dejar un directorio privado `.axon-cloud-<id>` para revisión.

OneDrive entrega descargas firmadas de corta duración. AXON acepta sólo HTTPS en dominios Microsoft admitidos, valida cada redirección y nunca reenvía el token OAuth a esas URLs. [Contrato de descarga](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0). Google usa el endpoint oficial `files.get?alt=media`. [Contrato de Google Drive](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

## Ampliación y logos

El contrato `src/cloud/provider.ts` separa autorización, estado, listado, metadatos y contenido. Las rutas, las preferencias y el motor de copias se comparten entre adaptadores; otro proveedor necesita implementar ese contrato y registrar su configuración/logo. No se muestran plataformas con conexiones ficticias.

Logos servidos localmente: Dropbox desde [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/dropbox.svg), Google Drive desde el [recurso de marca oficial](https://developers.google.com/workspace/drive/api/guides/branding), OneDrive desde el CDN oficial Microsoft Office (`fabric-cdn-prod_20221201.001/assets/brand-icons/product/svg/onedrive_48x1.svg`). Los nombres y marcas pertenecen a sus titulares.

La organización de Conexiones sigue la centralización de cuentas de [Notion](https://www.notion.com/en-gb/help/add-and-manage-connections-with-the-api) y [Dropbox App Center](https://help.dropbox.com/integrations/app-center). Se reutilizan las pestañas de configuración, botones, campos y tokens compactos de AXON; la búsqueda 21st de pestañas de settings se usó como referencia, sin agregar React.

## Verificación

`pnpm run check`, `pnpm run build`, `pnpm run test`. Las pruebas de adaptadores usan respuestas de proveedor controladas, y las copias ejecutan el worker Python real sobre discos fixture. La revisión de navegador `scripts/connections-browser-qa.cjs` comprueba fuentes visibles/conectadas, ocultar y restaurar, IDs remotos, recarga, texto seguro, configuración sin eco de secretos, selector de disco, logos, cuatro anchos y accesibilidad. Sus APIs de nube son simuladas. Las cuentas reales necesitan autorización del titular; estas pruebas no prueban aceptación OAuth de aplicaciones externas todavía sin registrar.
