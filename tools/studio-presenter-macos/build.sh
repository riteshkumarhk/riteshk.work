#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
node build-ui.mjs
app="dist/StudioPresenter.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp Info.plist "$app/Contents/Info.plist"
cp generated/companion.html "$app/Contents/Resources/companion.html"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  xcrun swiftc -parse-as-library -swift-version 5 -O -sdk "$sdk" -target "$arch-apple-macosx13.0" -framework AppKit -framework WebKit App.swift -o "dist/StudioPresenter-$arch"
done
lipo -create dist/StudioPresenter-arm64 dist/StudioPresenter-x86_64 -output "$app/Contents/MacOS/StudioPresenter"
codesign --force --deep --sign - "$app"
"$app/Contents/MacOS/StudioPresenter" --check-policy
ditto -c -k --sequesterRsrc --keepParent "$app" dist/StudioPresenter-macOS-UNVERIFIED.zip