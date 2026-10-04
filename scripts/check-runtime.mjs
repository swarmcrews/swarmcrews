// Built-ins only: diagnose an unsupported runtime before loading SDKs/tsx/Vite.
export function checkRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(`Node.js v${version} is unsupported; Node.js >=22.12.0 is required. Upgrade Node.js, then run \`pnpm install\` before starting Swarmcrews.`);
  }
}
