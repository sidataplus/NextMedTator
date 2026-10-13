"""Static GET-only local preview. Does not expose repository/private input files."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
from functools import partial
ROOT = Path(__file__).resolve().parents[1]

class StaticServer(ThreadingHTTPServer):
    # Chromium opens many module requests together. The default five-socket
    # backlog drops bursts on Windows before the worker threads accept them.
    request_queue_size = 128

class Handler(SimpleHTTPRequestHandler):
    # Windows registry MIME associations can otherwise serve modules as text/plain.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mjs':'text/javascript', '.js':'text/javascript',
                      '.wasm':'application/wasm'}
    def end_headers(self):
        header_file=Path(self.directory)/'_headers'
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
    print(f'Serving {args.directory} on http://127.0.0.1:{args.port}',flush=True)
    StaticServer(('127.0.0.1',args.port),partial(Handler,directory=str(path))).serve_forever()
