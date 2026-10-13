"""Use an explicit browser, installed desktop Chrome, or Playwright's Chromium."""
import os
import sys
from pathlib import Path


def chromium_path():
    configured = os.environ.get('CHROMIUM_PATH')
    if configured:
        return configured
    if sys.platform == 'win32':
        for root in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            candidate = Path(os.environ.get(root,''))/'Google/Chrome/Application/chrome.exe'
            if candidate.is_file():
                return str(candidate)
    if Path('/usr/bin/chromium').is_file():
        return '/usr/bin/chromium'
    return None
