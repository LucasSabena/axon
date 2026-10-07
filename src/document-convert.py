"""Convert a private, staged copy. Never open the original in LibreOffice.

The child has a fresh profile, no macros, private PID, network and filesystem namespaces. Restrictions fail closed; subprocesses inherit them.
"""
import json
import os
import pathlib
import resource
import signal
import subprocess
import sys
import zipfile
import re
import shutil
from html.parser import HTMLParser

SPREADSHEETS = {'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'ods', 'ots'}


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sheets = []
        self.heading = False
        self.name = ''
        self.current = None
        self.row = None
        self.cell = None
        self.span = 1
        self.cells = 0
        self.chars = 0
        self.truncated = False

    def handle_starttag(self, tag, attrs):
        if tag == 'h1':
            self.heading = True
            self.name = ''
        elif tag == 'table':
            if len(self.sheets) >= 50:
                self.truncated = True
                self.current = None
                return
            self.current = {'name': re.sub(r'^Sheet \d+:\s*', '', self.name.strip()) or 'Hoja ' + str(len(self.sheets) + 1), 'rows': []}
            self.sheets.append(self.current)
        elif tag == 'tr' and self.current is not None:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []
            try:
                self.span = max(1, min(100, int(dict(attrs).get('colspan', '1'))))
            except ValueError:
                self.span = 1
        elif tag == 'br' and self.cell is not None:
            self.cell.append('\n')

    def handle_data(self, data):
        if self.heading:
            self.name += data[:200]
        if self.cell is not None:
            if self.chars + len(data) > 5_000_000:
                self.truncated = True
            else:
                self.cell.append(data)
                self.chars += len(data)

    def handle_endtag(self, tag):
        if tag == 'h1':
            self.heading = False
        elif tag in ('td', 'th') and self.cell is not None:
            if len(self.row) < 100 and self.cells < 100000:
                self.row.append(''.join(self.cell).strip())
                self.row.extend([''] * min(self.span - 1, 100 - len(self.row)))
                self.cells += self.span
            else:
                self.truncated = True
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.current is not None and len(self.current['rows']) < 10000 and self.cells <= 100000:
                self.current['rows'].append(self.row)
            else:
                self.truncated = True
            self.row = None
        elif tag == 'table':
            self.current = None


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (55, 60))
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024**2, 100 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def sandbox_command(root, command):
    cmd = ['bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL']
    if os.getuid() == 0:
        cmd += ['--uid', '65534', '--gid', '65534']
    for folder in ['/usr', '/bin', '/lib', '/lib64', '/etc/fonts', '/etc/libreoffice', '/etc/ld.so.cache', '/etc/passwd', '/etc/group', '/etc/localtime', '/var/cache/fontconfig']:
        if os.path.exists(folder):
            cmd += ['--ro-bind', folder, folder]
    return cmd + ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
        '--bind', str(root), '/work', '--chdir', '/work', '--clearenv',
        '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/work',
        '--setenv', 'TMPDIR', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
        '--setenv', 'SAL_USE_VCLPLUGIN', 'svp', '--'] + command


def convert(work, ext):
    if not shutil.which('libreoffice') or not shutil.which('bwrap'):
        raise FileNotFoundError('Missing preview engine')
    root = pathlib.Path(work).resolve()
    source = root / ('input.' + ext)
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(e.file_size for e in entries) > 250 * 1024**2:
                raise ValueError('El documento comprimido supera el límite de vista previa.')
    profile = root / 'profile' / 'user'
    profile.mkdir(parents=True)
    (profile / 'registrymodifications.xcu').write_text('''<?xml version="1.0"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
</oor:items>''')
    # Bubblewrap maps the caller's host UID to the requested sandbox UID.
    # Keep ownership on the host: chown(65534) would make the private directory
    # inaccessible after entering the mapped namespace in a root-run image.
    probe = subprocess.run(sandbox_command(root, ['true']), stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    if probe.returncode:
        raise ValueError('El servidor no pudo aislar la conversión. Revisá Bubblewrap y los espacios de nombres de Linux.')
    spreadsheet = ext in SPREADSHEETS
    cmd = sandbox_command(root, ['libreoffice', '-env:UserInstallation=file:///work/profile',
           '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'html:HTML (StarCalc)' if spreadsheet else 'pdf',
           '--outdir', '/work', '/work/input.' + ext])
    proc = subprocess.Popen(cmd, cwd=root, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, preexec_fn=limits)
    try:
        code = proc.wait(timeout=65)
    finally:
        # Reap the entire conversion group, including helpers after an error.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    output = root / ('input.html' if spreadsheet else 'input.pdf')
    if code != 0 or not output.is_file() or output.stat().st_size < 5 or output.stat().st_size > 100 * 1024**2:
        raise ValueError('No se pudo convertir. Puede estar dañado, protegido con contraseña o superar los límites del visor.')
    if spreadsheet:
        tables = Tables()
        with output.open('r', encoding='utf-8', errors='replace') as fh:
            while chunk := fh.read(65536):
                tables.feed(chunk)
        if not tables.sheets:
            raise ValueError('No se encontraron hojas en la planilla.')
        (root / 'input.json').write_text(json.dumps({'sheets': tables.sheets, 'truncated': tables.truncated}, ensure_ascii=False), encoding='utf-8')
    else:
        with output.open('rb') as fh:
            if fh.read(5) != b'%PDF-':
                raise ValueError('La conversión no generó un PDF válido.')


if __name__ == '__main__':
    try:
        convert(sys.argv[1], sys.argv[2])
        print(json.dumps({'ok': True}))
    except FileNotFoundError:
        print(json.dumps({'ok': False, 'error': 'Falta LibreOffice o Bubblewrap en el servidor. Instalá Writer, Calc, Impress y Bubblewrap para habilitar el visor.'}))
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print(json.dumps({'ok': False, 'error': 'El documento tardó demasiado. Podés descargar el original.'}))
        sys.exit(1)
    except subprocess.SubprocessError:
        print(json.dumps({'ok': False, 'error': 'El servidor no pudo aislar la conversión. Requiere Linux con Bubblewrap y espacios de nombres habilitados.'}))
        sys.exit(1)
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, ValueError) else 'No se pudo preparar la vista previa.'}))
        sys.exit(1)
