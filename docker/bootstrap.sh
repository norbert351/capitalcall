#!/usr/bin/env bash
# Dev bootstrap for the Canton LocalNet (non-compose path).
# Usage: ./docker/bootstrap.sh
# 1) boots `daml start` (real Canton sandbox + JSON API) if not running
# 2) allocates the demo parties deterministically
# 3) prints the party map + package id for the backend
set -euo pipefail
DAML_DIR="$(cd "$(dirname "$0")/../daml" && pwd)"
PKG_ID="$(python3 - "$DAML_DIR" <<'PY'
import zipfile, re, sys
z = zipfile.ZipFile(sys.argv[1] + '/.daml/dist/capitalcall-0.1.0.dar')
m = z.read('META-INF/MANIFEST.MF').decode()
idx = m.index('Main-Dalf:')
seg = m[idx + len('Main-Dalf:'):].split('Dalfs:')[0]
hexchars = ''.join(c for c in seg if c in '0123456789abcdef')
print(hexchars[:64])
PY
)"
echo "Package ID: $PKG_ID"

echo "Allocating demo parties..."
for p in GP LP1 LP2 AUDIT VAULT; do
  docker run --rm --network host \
    -v "$DAML_DIR":/home/daml/work -w /home/daml/work \
    digitalasset/daml-sdk:2.10.2 daml ledger allocate-party "$p" --port 6865 --host localhost \
    | sed -n 's/.*Allocated \(.*\) for .*/\1/p'
done
echo "Bootstrap done. Run backend with:"
echo "  CANTON_LEDGER=json CANTON_JSON_URL=http://127.0.0.1:7575 CANTON_PACKAGE_ID=$PKG_ID"