"""Zip extension/ into public/torque-marketplace-lister.zip (downloadable from the CRM).

Usage: python3 -I scripts/pack-extension.py   (run after changing anything in extension/)
"""
import os, zipfile

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'extension')
out = os.path.join(here, '..', 'public', 'torque-marketplace-lister.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            if f.startswith('.'):
                continue
            path = os.path.join(root, f)
            z.write(path, os.path.join('torque-marketplace-lister', os.path.relpath(path, src)))
print(out, os.path.getsize(out), 'bytes')
