// cmd.exe has its own quoting rules; Node's default Windows argv escaping
// would inject backslashes into the already-quoted /c command string.
export function commandSpec(command, args, platform = process.platform) {
  if (platform !== "win32" || !command.endsWith(".cmd")) return { command, args, options: {} };
  if ([command, ...args].some(value => /["\r\n%&|<>^]/.test(value))) throw new Error("Unsafe Windows command argument");
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", `"${[command, ...args].map(value => `"${value}"`).join(" ")}"`],
    options: { windowsVerbatimArguments: true },
  };
}
