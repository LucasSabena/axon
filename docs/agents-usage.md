# Consumo de agentes y estimación de API

AXON consulta cuotas disponibles con las credenciales ya conectadas a cada proveedor y lee historiales locales de las herramientas compatibles. No hay una API universal de cuotas o consumo para todos los planes.

## Historial

- Codex y Claude Code: metadatos de uso en sus registros nativos, con deduplicación de acumulados y mensajes repetidos.
- OpenCode: SQLite nativo en lectura y almacenamiento heredado; los registros de la versión nueva tienen prioridad sobre copias antiguas.
- Gemini: metadatos disponibles en sus historiales nativos.
- Devin y otras herramientas: se indica cuando no existe un historial local compatible. No se inventa consumo a partir de la cuota del plan.

El índice incremental almacena metadatos de consumo, sin prompts, respuestas ni credenciales. Los filtros hoy, últimos 7/15/30 días y todo usan la zona horaria del navegador; los días incluyen el día actual.

La cuenta sólo se atribuye cuando el historial o su carpeta permiten identificarla. Si se cambió de cuenta dentro de un historial compartido, el creador del chat no demuestra la cuenta que pagó cada solicitud. Los datos sin atribución confiable quedan explícitamente sin cuenta.

## Precios

El catálogo público [Models.dev](https://models.dev) aporta proveedor, modelo y costos por millón de tokens. Se consulta `https://models.dev/api.json` sin credenciales, se conserva una copia local y se refresca al consultar después de 24 horas. También se puede solicitar un refresco desde el panel.

El cálculo separa input sin caché, output, lectura de caché y escritura de caché. El razonamiento se muestra como detalle de output cuando el proveedor ya lo incluye en esa cifra; no se vuelve a sumar. Se contemplan tarifas por contexto cuando el catálogo las ofrece y caché de una hora cuando su duración es conocida.

No se aplica el precio de un modelo distinto por aproximación. Si faltan tarifas o la identidad del modelo no es inequívoca, el consumo sigue visible y el precio se marca parcial o desconocido. Un costo cero registrado por una suscripción no transforma la tarifa API del modelo en cero.

La cifra en USD es **el equivalente estimado a precios de API del catálogo consultado**, no una factura ni el cargo de ChatGPT, Claude, Copilot u otra suscripción. No incluye impuestos, descuentos, contratos especiales, herramientas cobradas por separado o ajustes de factura. Tampoco reconstruye automáticamente precios históricos: muestra la fecha y fuente del catálogo utilizado.

Fuentes de contratos de uso: [OpenAI API Usage](https://platform.openai.com/docs/api-reference/usage), [Anthropic Usage and Cost](https://docs.anthropic.com/en/api/usage-cost-api), [OpenCode](https://github.com/anomalyco/opencode) y [Models.dev](https://github.com/anomalyco/models.dev). Las APIs organizacionales de facturación pueden requerir credenciales administrativas; conectar una cuenta de suscripción no concede ese acceso.
