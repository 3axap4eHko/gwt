#!/bin/sh
set -e

REPO="3axap4eHko/gwt"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  x86_64|amd64)  arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
esac

version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
url="https://github.com/${REPO}/releases/download/${version}/gwt-${os}-${arch}"

echo "Downloading gwt ${version} (${os}-${arch})..."
curl -fsSL -o /tmp/gwt "$url"
chmod +x /tmp/gwt
/tmp/gwt install
rm -f /tmp/gwt
