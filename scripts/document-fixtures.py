"""Generate synthetic Office fixtures using the installed LibreOffice engine."""
import pathlib
import subprocess
import sys
import tempfile


def fixtures(folder):
    folder = pathlib.Path(folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'lectura.rtf').write_text(r'{\rtf1\ansi\deff0 {\fonttbl{\f0 Arial;}}\f0\fs28 AXON PRIMERA PAGINA\par Documento de prueba.\page AXON SEGUNDA PAGINA\par El original se conserva.}')
    namespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"'
    (folder / 'diapositivas.fodp').write_text(f'''<?xml version="1.0"?>
<office:document {namespaces} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
<office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="21cm" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles>
<office:body><office:presentation>''' + ''.join(f'<draw:page draw:name="Slide{i}" draw:master-page-name="Default"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="22cm" svg:height="5cm"><draw:text-box><text:p>AXON DIAPOSITIVA {i}</text:p></draw:text-box></draw:frame></draw:page>' for i in [1, 2]) + '</office:presentation></office:body></office:document>')
    (folder / 'planilla.fods').write_text(f'''<?xml version="1.0"?>
<office:document {namespaces} office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet>''' + ''.join(f'<table:table table:name="{name}"><table:table-row><table:table-cell office:value-type="string"><text:p>AXON {name.upper()}</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="{value}"><text:p>{value}</text:p></table:table-cell></table:table-row></table:table>' for name, value in [('Resumen', 123.45), ('Detalle', 678.9)]) + '</office:spreadsheet></office:body></office:document>')
    with tempfile.TemporaryDirectory(prefix='axon-office-fixtures-') as temp:
        for source, formats in [('lectura.rtf', ['doc', 'docx', 'odt', 'pdf']), ('diapositivas.fodp', ['ppt', 'pptx', 'odp']), ('planilla.fods', ['xls', 'xlsx', 'ods'])]:
            for ext in formats:
                result = subprocess.run(['libreoffice', '-env:UserInstallation=' + pathlib.Path(temp, 'profile').as_uri(), '--headless', '--convert-to', ext, '--outdir', str(folder), str(folder / source)], capture_output=True, text=True, timeout=30)
                target = folder / (pathlib.Path(source).stem + '.' + ext)
                if result.returncode or not target.is_file():
                    raise RuntimeError(f'Fixture conversion failed: {source} -> {ext}: {result.stderr}')
    (folder / 'tabla.csv').write_text('\ufeffNombre;Importe;Nota\r\nPeña;123,45;"dos\nlíneas"\r\n"<script>alert(1)</script>";0;"comillas ""dobles"""\r\n', encoding='utf-8')
    (folder / 'tabla.tsv').write_text('Nombre\tValor\nMóvil\t42\n', encoding='utf-8')
    (folder / 'dañado.docx').write_bytes(b'Not a valid Office document\x00\xff')
    (folder / 'vacio.xlsx').write_bytes(b'')


if __name__ == '__main__':
    fixtures(sys.argv[1])
