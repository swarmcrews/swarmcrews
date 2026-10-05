export const NODE_VERSION = "24.21.0";
// Official nodejs.org/dist/v24.21.0/SHASUMS256.txt, pinned for review.
export const TARGETS = {
  "linux-x64": { archive: "tar.gz", sha256: "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff" },
  "darwin-x64": { archive: "tar.gz", sha256: "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097" },
  "darwin-arm64": { archive: "tar.gz", sha256: "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057" },
  "win32-x64": { archive: "zip", sha256: "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541" },
};
export const RUNTIME_PACKAGES = ["@modelcontextprotocol/sdk", "ajv", "better-sqlite3", "express", "import-meta-resolve", "jsdom", "ws", "zod"];
export function isProviderPackage(name) {
  return /^@(?:anthropic-ai\/claude|openai\/codex|github\/copilot|mariozechner\/pi-|earendil-works\/pi-)|^opencode-ai(?:-|$)/.test(name);
}
export function releaseTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!Object.hasOwn(TARGETS, target)) throw new Error(`Unsupported release target: ${target}`);
  return target;
}
export function assertReleaseVersion(version, tag) {
  if (!/^\d+\.\d+\.\d+-alpha\.[1-9]\d*$/.test(version) || tag !== `v${version}`) {
    throw new Error("Release tag must match the exact alpha package version");
  }
}
