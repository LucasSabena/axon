"""QA del panel 'Enviar al escritorio' (/escritorio).

Verifica: render del panel, bridge texto -> iframe (clipboard remoto y
paste), pegar imagen del portapapeles, y upload chunked real a ~/Downloads
(que en QA resuelve al fixture root aislado).
El iframe /desktop/view tiene CSP sin unsafe-eval, asi que los mensajes se
capturan envolviendo contentWindow.postMessage desde la pagina padre.
"""
import io
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3459'
DESKTOP_FIXTURE = {
    "ok": True,
    "connected": True,
    "state": "active",
    "missing": [],
    "applications": [{"id": "terminal", "name": "Terminal"}],
}
STATUS = "document.querySelector('[data-send-status]').textContent"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        errors = []
        try:
            ctx = browser.new_context(viewport={'width': 1440, 'height': 1100})
            page = ctx.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))

            ctx.route('**/api/desktop', lambda route: route.fulfill(
                status=200, content_type='application/json',
                json=DESKTOP_FIXTURE))

            page.goto(BASE)
            page.fill('#username', 'qa')
            page.fill('#password', 'axon-local-qa')
            page.locator('#login-form').evaluate('f => f.requestSubmit()')
            page.wait_for_function(
                "document.querySelector('#login-screen').classList.contains('hidden')")

            page.goto(BASE + '/escritorio')
            page.locator('[data-send-text]').wait_for(timeout=30000)

            for sel in ['[data-send-clipboard]', '[data-send-paste]',
                        '[data-send-file]', '[data-send-dir]', '[data-send-upload]',
                        '[data-send-status]']:
                assert page.locator(sel).count() == 1, f'falta {sel}'

            assert page.frames and any('/desktop/view' in f.url for f in page.frames), \
                'no se cargo el visor'

            # Captura de postMessage padre -> iframe (el frame tiene CSP
            # estricto, no se puede evaluar dentro).
            page.evaluate("""() => {
                const f = document.querySelector('iframe.platform-frame');
                window.__sent = [];
                const orig = f.contentWindow.postMessage.bind(f.contentWindow);
                f.contentWindow.postMessage = (m, o) => {
                    window.__sent.push(m);
                    return orig(m, o);
                };
            }""")

            # 1) Texto al portapapeles remoto
            page.fill('[data-send-text]', 'texto de prueba áéíóú')
            page.click('[data-send-clipboard]')
            page.wait_for_function(
                "window.__sent.some(m => m.type === 'axon:desktop-paste' "
                "&& m.text === 'texto de prueba áéíóú' && !m.paste)")
            status = page.text_content('[data-send-status]')
            assert 'portapapeles remoto' in status, status

            # 2) Enviar y pegar (Ctrl+V remoto)
            page.click('[data-send-paste]')
            page.wait_for_function(
                "window.__sent.some(m => m.type === 'axon:desktop-paste' "
                "&& m.text === 'texto de prueba áéíóú' && m.paste === true)")
            assert 'pegado' in page.text_content('[data-send-status]')

            # 3) Pegar una imagen del portapapeles en el textarea -> queda
            #    lista para subir como archivo.
            page.evaluate("""() => {
                const box = document.querySelector('[data-send-text]');
                const file = new File([new Uint8Array([137, 80, 78, 71])],
                                      'image.png', {type: 'image/png'});
                const dt = new DataTransfer();
                dt.items.add(file);
                box.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: dt, bubbles: true, cancelable: true}));
            }""")
            page.wait_for_function(
                STATUS + ".includes('Imagen del portapapeles lista')")
            status = page.text_content('[data-send-status]')
            assert 'captura-' in status and '.png' in status, status

            # 4) Subir la imagen pegada a ~/Downloads (fixture root en QA)
            page.click('[data-send-upload]')
            page.wait_for_function(
                "/Subido a/.test(" + STATUS + ")", timeout=30000)
            status = page.text_content('[data-send-status]')
            assert 'captura-' in status and '.png' in status, status
            # la ruta quedo en el portapapeles remoto
            page.wait_for_function(
                "window.__sent.some(m => /captura-.*\\.png/.test(m.text || ''))")

            # 5) Archivo elegido por el selector a ~/Desktop
            page.set_input_files('[data-send-file]', files=[{
                'name': 'foto liviana.jpg', 'mimeType': 'image/jpeg',
                'buffer': io.BytesIO(b'\\xff\\xd8fake-jpeg-data').getvalue()}])
            page.select_option('[data-send-dir]', '~/Desktop')
            page.click('[data-send-upload]')
            page.wait_for_function(
                "/Subido a.*foto liviana\\.jpg/.test(" + STATUS + ")",
                timeout=30000)

            # 6) Estado limpio: sin archivo pide elegir uno
            page.click('[data-send-upload]')
            page.wait_for_function(
                STATUS + ".includes('Elegí un archivo')")

            print('TODOS LOS CHECKS PASARON')
        finally:
            browser.close()
        assert not errors, 'pageerror: ' + ' | '.join(errors)


if __name__ == '__main__':
    main()
