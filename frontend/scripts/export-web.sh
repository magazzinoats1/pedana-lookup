#!/bin/bash
# Builds the website version of the app, served by the backend at /api/app.
set -e
cd "$(dirname "$0")/.."
OUT=/app/backend/web
WEB_EXPORT=1 npx expo export --platform web --output-dir "$OUT"
# Deploys skip any "node_modules" folder: move bundled assets (icon fonts) out of it
if [ -d "$OUT/assets/node_modules" ]; then
  mv "$OUT/assets/node_modules" "$OUT/assets/vendor"
  grep -rl "assets/node_modules/" "$OUT/_expo" | xargs -r sed -i 's#assets/node_modules/#assets/vendor/#g'
fi
sed -i 's/<html lang="en"/<html lang="it"/' "$OUT/index.html"
echo "Web export ready in $OUT"
