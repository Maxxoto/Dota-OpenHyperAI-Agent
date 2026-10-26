## Quick Install Scripts

These scripts create a symbolic link from the Steam Workshop download folder to the Dota 2 vscripts/bots folder. This lets the bot scripts load correctly in Custom Lobbies with **Local Host** server.

### Installing a git clone of this fork

The `quick-install-oha*` scripts install the **Steam Workshop** copy (bots only). A git clone needs both `bots/` and `game/` linked, plus the permanent config tier:

| File                     | OS            |
| ------------------------ | ------------- |
| `quick-install-fork.ps1` | Windows       |
| `quick-install-fork.sh`  | macOS / Linux |

They back up any existing `bots` / `game` folders with a timestamp, link both from the clone, create `game/Customize` (config tier, gitignored) if missing, verify the links, and optionally write your Groq key as a one-line `game/Customize/llm.lua`.

```powershell
powershell -ExecutionPolicy Bypass -File quick-install-fork.ps1
```

```bash
./quick-install-fork.sh
```

FretBots starts automatically at hero selection once both links exist (verified working in a Local Dev Script lobby). The console command below is only a fallback for Workshop-style installs that link `bots/` alone: `sv_cheats 1; script_reload_code bots/fretbots`.

### Available Scripts

| File                         | OS      | Language |
| ---------------------------- | ------- | -------- |
| `quick-install-oha.bat`      | Windows | English  |
| `quick-install-oha-cn.bat`   | Windows | Chinese  |
| `quick-install-oha-mac.sh`   | macOS   | English  |
| `quick-install-oha-linux.sh` | Linux   | English  |

---

## Usage — Windows

1. In Dota 2, subscribe to **Open Hyper AI** in the Steam Workshop. Wait for the download to complete.
2. Navigate to folder: `Steam\steamapps\workshop\content\570\3246316298\Install-to-vscript`
3. Double-click `quick-install-oha.bat` to install.

**Finding the folder:** Right-click Dota 2 in your Steam Library → Properties → Installed Files → Browse. This opens `Steam\steamapps\common\dota 2 beta`. In the address bar, replace `common\dota 2 beta` with `workshop\content\570\3246316298\Install-to-vscript` and press Enter.

---

## Usage — macOS

1. Subscribe to **Open Hyper AI** in the Steam Workshop and wait for download.
2. Open Terminal.
3. Navigate to the script folder:
    ```bash
    cd ~/Library/Application\ Support/Steam/steamapps/workshop/content/570/3246316298/Install-to-vscript
    ```
4. Make it executable and run:
    ```bash
    chmod +x quick-install-oha-mac.sh
    sudo ./quick-install-oha-mac.sh
    ```

---

## Usage — Linux

1. Subscribe to **Open Hyper AI** in the Steam Workshop and wait for download.
2. Open a terminal.
3. Navigate to the script folder (common Steam locations):
    ```bash
    # Try one of these:
    cd ~/.steam/steam/steamapps/workshop/content/570/3246316298/Install-to-vscript
    cd ~/.local/share/Steam/steamapps/workshop/content/570/3246316298/Install-to-vscript
    ```
4. Make it executable and run:
    ```bash
    chmod +x quick-install-oha-linux.sh
    sudo ./quick-install-oha-linux.sh
    ```

The Linux script automatically checks multiple common Steam install locations (`~/.steam/steam`, `~/.local/share/Steam`, `~/.steam/debian-installation`).

---

## How It Works

The script creates a **symbolic link** from the Workshop folder to the Dota 2 vscripts directory:

```
Workshop:  Steam/steamapps/workshop/content/570/3246316298
     ↓ (symlink)
Target:    Steam/steamapps/common/dota 2 beta/game/dota/scripts/vscripts/bots
```

Any Workshop updates to the script will automatically appear in the local dev folder.

## Why Is This Needed?

Some players experience issues where bots fail to load correctly from the Workshop folder alone. Installing the scripts to the vscripts/bots folder via symlink resolves these issues while keeping auto-updates from Workshop.

## Uninstall

To uninstall, simply delete the symbolic link in the target folder:

**Windows:**

```cmd
rmdir "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\scripts\vscripts\bots"
```

**macOS:**

```bash
rm ~/Library/Application\ Support/Steam/steamapps/common/dota\ 2\ beta/game/dota/scripts/vscripts/bots
```

**Linux:**

```bash
rm ~/.steam/steam/steamapps/common/dota\ 2\ beta/game/dota/scripts/vscripts/bots
```

This only removes the shortcut — your Workshop subscription and Dota 2 files are not affected.

---

## Troubleshooting

-   **"Steam folder not found"**: Make sure Steam and Dota 2 are installed. If Steam is in a custom location, edit the script and set the path manually.
-   **"Workshop folder not found"**: Subscribe to Open Hyper AI in Workshop and wait for the download to complete before running the script.
-   **Permission errors**: Run with administrator privileges (`Run as Administrator` on Windows, `sudo` on Mac/Linux).
-   **Bots still not loading**: Create a Custom Lobby and select **Local Host** as the server location.

For more detailed guides: https://github.com/forest0xia/dota2bot-OpenHyperAI/discussions
