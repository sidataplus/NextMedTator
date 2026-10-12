"""Opt-in, reviewed R2 catalog metadata. This module never reads credentials."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


def r2_catalog():
    configured = os.environ.get('NMT_MODEL_CATALOG')
    if not configured:
        return {'entries': []}
    catalog = json.loads(Path(configured).read_text())
    if set(catalog) != {'entries'} or not isinstance(catalog['entries'], list):
        raise ValueError('Expected an explicitly reviewed model catalog')
    for entry in catalog['entries']:
        delivery = entry.get('delivery', {})
        origin = delivery.get('origin', '')
        parsed = urlsplit(origin)
        revision = entry.get('revision', '')
        prefix = f'/nextmedtator-models/{revision}/'
        if (delivery.get('kind') != 'r2' or not re.fullmatch(r'[a-f0-9]{64}', revision)
                or delivery.get('prefix') != prefix or parsed.scheme != 'https'
                or not parsed.hostname or parsed.username or parsed.password or parsed.port
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError('R2 catalog requires an explicit HTTPS origin and immutable prefix')
        files = entry.get('manifest', {}).get('files', [])
        if not files or set(entry.get('urls', {})) != {f['path'] for f in files}:
            raise ValueError('Every model file requires an exact URL')
        for file in files:
            path = file['path']
            if (not path or any(not re.fullmatch(r'[a-zA-Z0-9._-]+',part) or part in ('.','..') for part in path.split('/'))
                    or entry['urls'][path] != origin + prefix + path):
                raise ValueError('R2 URL is outside the reviewed immutable prefix')
    return catalog


def connect_origins():
    return sorted({entry['delivery']['origin'] for entry in r2_catalog()['entries']})
