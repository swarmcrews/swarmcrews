# Choosing repository folders

The project path field supports typing, pasting, autocomplete, and **Browse** on
desktop and mobile. All paths refer to the machine running the Swarmcrews
server. For example, a phone connected to a Windows server selects Windows
folders.

Type part of a path to see matching child folders. Use the arrow keys and
Enter or Tab to select a suggestion. Escape dismisses suggestions. **Browse**
lets you navigate folders and breadcrumbs; **Use this folder** fills the path
field. Click **Open** or **Create** when you are ready to initialize the project.
You can also type a new folder path directly.

When you type an ancestor or partial ancestor of a browsing location (for
example `/home` or `/ho` when the server home is `/home/alex`), suggestions
point directly to the permitted location. Swarmcrews does not list other users’
folders or make the ancestor selectable. **Browse locations** always returns to
the configured locations, including after an unavailable path.

## Paths on each server platform

| Server | Example |
| --- | --- |
| Linux | `/home/alex/projects/my-app` |
| macOS | `/Users/alex/projects/my-app` or `/Volumes/Work/my-app` |
| Windows drive | `C:\Users\Alex\projects\my-app` |
| Windows network share | `\\fileserver\projects\my-app` |

`~/projects/my-app` expands to the **server user's** home directory. Pasted
absolute paths may be wrapped in matching single or double quotes. Windows
servers accept forward slashes as well as backslashes, including mixed
separators. Spaces and Unicode names are supported.

Use a full drive path such as `C:\projects\my-app`; `C:projects\my-app` and
`\projects\my-app` depend on a working drive and are rejected. Windows device
namespaces and alternate data streams are not repository paths. Filesystem
permissions and the host's path-length support still apply.

## Local and remote access

Browsing uses the same server-side filesystem whether you connect locally or
remotely. A remote browser cannot select files from its own device through this
picker. Use `~` to start from the server account’s home directory, which may be
different from your desktop account’s home.

Connect through localhost (including an SSH tunnel) or the server’s Tailscale
address. Unsupported or mismatched request hosts/origins are blocked; changing
browsing roots does not change that access policy.

## Configure browsing locations

Browsing defaults to the server user's home folder. To expose other locations,
set `SWARMCREWS_BROWSE_ROOTS` to a JSON array before starting the server. This
replaces the default, so include the home folder if you want to keep it.

Linux or macOS (Bash):

```bash
export SWARMCREWS_BROWSE_ROOTS='["~/projects", "/Volumes/Work"]'
pnpm start
```

Windows (PowerShell):

```powershell
$env:SWARMCREWS_BROWSE_ROOTS = '["C:/Users/Alex/projects", "D:/Repos", "//fileserver/projects"]'
pnpm start
```

Use locations that exist and are readable by the account running the server.
Restart an already-running server after changing its startup environment.
An empty array disables directory discovery. Malformed configuration fails
closed. The browser cannot expand these roots through an API request. If no
locations appear, check both this setting and permissions for the server account.
If a folder is outside the configured locations, add it on the server and restart,
or type its path manually instead of browsing.

Discovery lists directories within the configured roots, including checks on
resolved symlink or junction targets. It does not read file contents, create
folders, initialize Git, or register projects. Listings are shallow and bounded;
if results are truncated, type a more specific prefix. The browsing roots govern
discovery; manually opening a path still follows the existing explicit project
registration flow.
