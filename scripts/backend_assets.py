"""Bundle compiled local backends; fail if source was not built first."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[1]
def copy_backend_assets(out):
    for name in ['LICENSE','LICENSE.NextMedTator','NOTICE.NextMedTator']:
        shutil.copyfile(ROOT/name,out/name)
    core=ROOT/'wasm/core/target/wasm32-unknown-unknown/release/nextmedtator_core.wasm'
    if not core.is_file():raise RuntimeError('Run pnpm build:core with Rust 1.90.0 first')
    target=out/'app/nextmedtator/backend';target.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(core,target/'core.wasm')
    shutil.copyfile(ROOT/'wasm/THIRD-PARTY-NOTICES.txt',target/'THIRD-PARTY-NOTICES.txt')
    sqlite=ROOT/'node_modules/@sqlite.org/sqlite-wasm/dist';target=out/'vendor/sqlite';target.mkdir(parents=True,exist_ok=True)
    for name in ['index.mjs','sqlite3.wasm','sqlite3-opfs-async-proxy.js']:
        shutil.copyfile(sqlite/name,target/name)
    (target/'NOTICE.txt').write_text('SQLite-WASM package @sqlite.org/sqlite-wasm 3.53.4-build2 (Apache-2.0 wrapper). SQLite core is public domain. Bundled unchanged from the pinned npm release. https://sqlite.org/copyright.html\n')


PUBLIC_MODEL_FILES=frozenset(['catalog.json','reference.json','binding-reference.json',
    'native-reference.json','attrs-reference.json','records-reference.json','heads-reference.json'])

def copy_public_models(source,out):
    """Only reviewed public catalog metadata/fixtures may enter static output."""
    source=Path(source)
    if not source.exists():return
    members=list(source.rglob('*'))
    for path in members:
        if path.is_symlink() or not path.is_file() or path.relative_to(source).as_posix() not in PUBLIC_MODEL_FILES:
            raise ValueError('Unreviewed file in public model metadata directory; keep private schemas, notes and weights outside static assets')
    (out/'models').mkdir(parents=True,exist_ok=True)
    for path in members:shutil.copyfile(path,out/'models'/path.name)
