"""Static GET-only local preview. Does not expose repository/private input files."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os
ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        header_file=Path.cwd()/'_headers'
        if header_file.exists():
            section=None
            for line in header_file.read_text().splitlines():
                if line and not line[0].isspace():section=line.strip()
                elif section=='/*' and ':' in line:
                    name,value=line.strip().split(':',1);self.send_header(name,value.strip())
        super().end_headers()
    def log_message(self,*args):
        pass

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--directory',choices=['dist','preview'],default='preview')
    parser.add_argument('--port',type=int,default=4173)
    args=parser.parse_args();path=ROOT/args.directory
    if not (path/'index.html').exists():parser.error('Build the static output first')
    os.chdir(path)
    print(f'Serving {args.directory} on http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
