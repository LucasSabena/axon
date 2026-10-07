# Login condicional en dos pasos — 2026-10-07

El flujo anterior mostraba un campo opcional de código tras cualquier error de login, incluso una contraseña incorrecta de una cuenta sin 2FA. Se reemplazó por una decisión explícita del servidor después de comprobar usuario y contraseña.

1. Cuenta sin 2FA: credenciales correctas crean la sesión directamente.
2. Cuenta con 2FA: credenciales correctas devuelven `requiresSecondFactor` y una prueba pendiente, sin crear sesión. La interfaz borra la contraseña, oculta/deshabilita el primer paso y enfoca el código obligatorio.
3. Código TOTP o recuperación válido: se consume la prueba pendiente y recién entonces se crea la sesión. Un código incorrecto se puede reintentar; volver y vencimiento restituyen el primer paso.

La prueba pendiente es aleatoria de 256 bits, vive sólo en memoria durante cinco minutos, se vincula al origen de la solicitud y a las credenciales actuales. Tiene un límite de cinco fallos y un registro acotado. No es un token de sesión. Cambiar usuario, contraseña o secreto 2FA invalida las pruebas anteriores. Los controles de fallos por IP y globales siguen compartidos con el login. Se conserva compatibilidad con clientes que ya envían credenciales y código juntos.

La referencia funcional fue el paso posterior a la contraseña documentado por [GitHub](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/accessing-github-using-two-factor-authentication). Se revisaron referencias 21st; se conservaron los controles y tokens de AXON sin incorporar componentes React ajenos al proyecto.

Validación local:

- Suite completa: 307 tests, 50 archivos, 2635 assertions, cero fallos.
- Cinco tests del contrato de pruebas pendientes: expiración, consumo, origen, cambio de credenciales, intentos y capacidad.
- Diez contratos HTTP reales: sesión, rotación, enrolamiento, desafío sin cookie de administrador, credenciales incorrectas sin información de 2FA, retry/replay y recuperación única.
- Navegador: nueve flujos, 12 layouts iniciales y seis combinaciones de tema/ancho en el segundo paso, reglas Axe sin fallos. La cuenta temporal activó 2FA realmente: contraseña incorrecta mantuvo el primer paso, contraseña correcta mostró el segundo sin sesión, y un código de recuperación completó el acceso.
- TypeScript, sintaxis, build y revisión determinista 21st pasan.

Evidencia JSON: `2026-10-07/login-dos-pasos/`. Screenshots y logs: `/tmp/axon-audit-20261007/two-step-login/` y archivos `two-step-*.log`.

Cambios locales; no se desplegaron a producción ni se cambiaron credenciales de una cuenta real. Las pruebas retiraron el 2FA de la fixture al terminar.
