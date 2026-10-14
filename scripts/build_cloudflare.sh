#!/usr/bin/env bash
# Cloudflare Pages' Linux image supplies Node/pnpm/Python, but not Rust or uv.
set -euo pipefail
cd "$(dirname "$0")/.."

tools_dir="$PWD/.cache/cloudflare-tools"
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$tools_dir/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
    mkdir -p .cache
    curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location \
        https://sh.rustup.rs --output .cache/cloudflare-rustup-init.sh
    sh .cache/cloudflare-rustup-init.sh -y --no-modify-path --profile minimal \
        --default-toolchain 1.90.0
fi
rustup toolchain install 1.90.0 --profile minimal --target wasm32-unknown-unknown

# Isolate build tooling from the image's managed Python installation.
python3 -m venv "$tools_dir"
"$tools_dir/bin/python" -m pip install --disable-pip-version-check --only-binary=:all: uv==0.13.0
uv --version
cargo +1.90.0 --version

# Pages skips its automatic installs; all application dependencies stay locked.
pnpm install --frozen-lockfile
node scripts/build_production.mjs
node scripts/audit_assets.mjs
