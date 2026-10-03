import {spawnSync} from 'node:child_process';
const result=spawnSync('cargo',['+1.90.0','build','--manifest-path','wasm/core/Cargo.toml','--locked','--release','--target','wasm32-unknown-unknown'],{stdio:'inherit'});
if(result.error)throw Error('Install Rust 1.90.0 with wasm32-unknown-unknown; see docs/nextmedtator/WASM-BACKEND.md');
if(result.status!==0)process.exit(result.status??1);
