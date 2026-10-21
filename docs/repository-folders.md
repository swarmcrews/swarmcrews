# Choosing repository folders

On the desktop home page, the folder chooser stays closed while projects load and when
you already have projects. **Choose folder** and **Enter a path instead** appear
together below the Project folder header. If your project list is empty, the
chooser opens automatically. Cancel keeps it closed until you open it again.

The folder browser starts at **Home** on the machine running Swarmcrews, on
desktop and mobile. For example, a phone connected to a Windows server selects
Windows folders. If Home is outside the server's configured browsing locations,
the chooser shows those locations instead.

Choose **Star folder** beside the current breadcrumb to save a browsing shortcut.
You can star multiple folders. To star a parent folder, navigate to it using its
breadcrumb and click its star. **Locations** lists Home first, your starred
folders with their full paths, and an option to browse configured server locations.
Click a saved folder to browse inside it; **Use “folder-name”** still confirms the
project selection. New visits start at Home without automatically selecting a
starred folder. Stars are saved in this browser for this server address, on
desktop and mobile.

Click the filled star beside the breadcrumbs, or the remove-star button beside a
saved location, to unstar that folder. Removing a shortcut keeps your current
project selection. If a saved folder is unavailable or outside browsing locations,
choose Home or another location; you can still remove its shortcut in Locations.

Click a folder to open it. **Search folders** filters folder names inside the
current location as you type, including when the initial list is truncated.
Use the breadcrumbs, **Home**, **Locations**, and **Up one folder** to navigate.
The search text is a folder-name filter, not a filepath or a recursive search.

If a search has no matching folders, Swarmcrews can offer **Use new folder
“name”** with its full destination path inside the current folder. It checks that
the name is valid and unused, including collisions with files or symlinks.
Choose that option, or Ctrl+Enter, to select the destination. The desktop form
switches to **Create**. Selecting it keeps the filesystem unchanged; click
**Create** (or **Register project** on mobile) and choose Git initialization or
continuing without Git when prompted. That action creates the folder.
Use manual entry for full paths or nested folder paths. **Change folder** returns
to the existing parent while the selected new folder has not been created.

Choose **Use “folder-name”** beside the breadcrumbs to confirm the current folder.
The selected folder's name and full path appear in a summary; **Change folder**
opens the chooser again.
Browsing, searching, Cancel, and Escape keep your existing choice. Opening or
registering a project stays disabled until you confirm a folder and finish the
chooser. Browsing and starring do not change
files, create a project, or initialize Git.

Use up/down arrows to navigate folder rows and Enter to open one. Alt+Up goes up
one folder within the allowed location. Tab moves between controls; Escape
cancels. The confirmation button selects the current folder; Ctrl+Enter from
the search field is its keyboard shortcut. When an empty search offers a new
folder, Ctrl+Enter selects that destination instead.

To paste or write a full filepath, close the browser with Cancel or Escape,
then choose **Enter a path instead** beside **Choose folder** or **Change folder**.
This opens a separate draft field. **Use this path** (or Enter in that field)
confirms the typed path, including a new folder path or one outside browsing
locations. Cancel keeps your existing selection. The typed path does not need
folder discovery to succeed. Then click **Open** or **Create** to continue the
project workflow; creating a folder or initializing Git follows that separate,
explicit action.

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
if results are truncated, use Search folders to narrow the current location. The browsing roots govern
discovery; manually opening a path still follows the existing explicit project
registration flow.
