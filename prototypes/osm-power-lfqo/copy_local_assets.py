#!/usr/bin/env python3
"""Copy the already generated snapshot into Next public assets. No network or R2 upload."""
import hashlib
import json
from pathlib import Path
import shutil

source = Path(__file__).parent/'snapshot-2026-11-11-63kv'
manifest = json.loads((source/'manifest.json').read_text())
repo = Path(__file__).resolve().parents[2]
target = repo/'public/osm-power/lfqo'/manifest['dataset_sha256'][:16]
for tile in manifest['tiling']['tiles']:
    path = source/tile['key']
    if hashlib.sha256(path.read_bytes()).hexdigest() != tile['sha256']:
        raise ValueError('Source tile checksum mismatch: '+str(path))
for key in ['manifest.json'] + [tile['key'] for tile in manifest['tiling']['tiles']]:
    dest = target/key
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source/key, dest)
print(target)
