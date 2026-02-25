import { copyFileSync, chmodSync, unlinkSync } from "fs";
import { getCurrentVersion, debug } from "../core/repo";

const REPO = "3axap4eHko/gwt";
const TMP_PATH = "/tmp/gwt-update";

const PLATFORMS: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
};

const ARCHS: Record<string, string> = {
  x64: "x64",
  arm64: "arm64",
};

export async function update(): Promise<void> {
  const os = PLATFORMS[process.platform];
  if (!os) throw new Error(`Unsupported platform: ${process.platform}`);
  const arch = ARCHS[process.arch];
  if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);

  const apiUrl = `https://api.github.com/repos/${REPO}/releases/latest`;
  debug("fetch", apiUrl);
  const response = await fetch(apiUrl, {
    headers: { "User-Agent": "gwt" },
  });
  debug("response", response.status, response.statusText);
  if (!response.ok) throw new Error(`Failed to fetch latest release: ${response.status}`);

  const release = await response.json() as { tag_name: string };
  const latest = release.tag_name;
  const current = getCurrentVersion();
  const latestBare = latest.replace(/^v/, "");
  debug("version", { current, latest: latestBare });

  if (latestBare === current) {
    console.log(`Already up to date (${current})`);
    return;
  }

  const binaryName = `gwt-${os}-${arch}`;
  const url = `https://github.com/${REPO}/releases/download/${latest}/${binaryName}`;

  debug("fetch", url);
  console.log(`Downloading gwt ${latest} (${os}-${arch})...`);
  const binary = await fetch(url);
  debug("response", binary.status, binary.statusText);
  if (!binary.ok) throw new Error(`Failed to download binary: ${binary.status}`);

  try {
    await Bun.write(TMP_PATH, binary);
    chmodSync(TMP_PATH, 0o755);

    try { unlinkSync(process.execPath); } catch {}
    copyFileSync(TMP_PATH, process.execPath);
    chmodSync(process.execPath, 0o755);
  } finally {
    try { unlinkSync(TMP_PATH); } catch {}
  }

  debug("replaced", process.execPath);
  console.log(`Updated gwt ${current} -> ${latestBare}`);
}
