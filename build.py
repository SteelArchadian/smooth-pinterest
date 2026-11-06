import hashlib, json, pathlib, subprocess, zipfile
root = pathlib.Path(__file__).parent
ver = json.loads((root / 'extension' / 'manifest.json').read_text())['version']
ahk = pathlib.Path.home() / 'AppData/Local/Programs/AutoHotkey'
import sys
for f in (root / 'extension').rglob('*'):
    if f.is_file() and f.suffix != '.png': f.read_bytes().decode('utf-8')  # Opera rejects non-UTF-8 files
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist'; out.mkdir(parents=True, exist_ok=True)
exe = out / 'SmoothPinterest.exe'
subprocess.run([str(ahk / 'Compiler/Ahk2Exe.exe'), '/in', str(root / 'helper/SmoothPinterest.ahk'),
                '/out', str(exe), '/base', str(ahk / 'v2/AutoHotkey64.exe')], check=True)
zp = out / 'SmoothPinterest.zip'
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(exe, 'SmoothPinterest.exe')
    z.write(root / 'README.md', 'README.md')
    for f in (root / 'extension').rglob('*'):
        if f.is_file(): z.write(f, f.relative_to(root))
print('Built', zp, 'version', ver)
print('SmoothPinterest.exe SHA-256:', hashlib.sha256(exe.read_bytes()).hexdigest())
