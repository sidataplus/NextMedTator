"""Bundle compiled local backends; fail if source was not built first."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[1]
def copy_backend_assets(out):
    core=ROOT/'wasm/core/target/wasm32-unknown-unknown/release/nextmedtator_core.wasm'
    if not core.is_file():raise RuntimeError('Run pnpm build:core with Rust 1.90.0 first')
    target=out/'app/nextmedtator/backend';target.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(core,target/'core.wasm')
    shutil.copyfile(ROOT/'wasm/THIRD-PARTY-NOTICES.txt',target/'THIRD-PARTY-NOTICES.txt')
    sqlite=ROOT/'node_modules/@sqlite.org/sqlite-wasm/dist';target=out/'vendor/sqlite';target.mkdir(parents=True,exist_ok=True)
    for name in ['index.mjs','sqlite3.wasm','sqlite3-opfs-async-proxy.js']:
        shutil.copyfile(sqlite/name,target/name)
    (target/'NOTICE.txt').write_text('SQLite-WASM package @sqlite.org/sqlite-wasm 3.53.4-build2 (Apache-2.0 wrapper). SQLite core is public domain. Bundled unchanged from the pinned npm release. https://sqlite.org/copyright.html\n')
