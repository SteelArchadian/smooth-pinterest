# Smooth Pinterest

A smoother Pinterest for Opera GX (and other Chromium browsers). It brings back the keyboard slideshow Pinterest removed and adds a fast full-screen viewer, so flipping through pins feels like swiping on a phone.

## What it does

- **Keyboard slideshow.** Click a pin, then **A**, **W** or the left arrow goes to the previous pin of the page you came from (home feed, search, board, related pins), and **D**, **S** or the right arrow goes to the next. Pins slide sideways, and you can drag with the mouse to swipe.
- **Fast viewer.** Clicking a pin opens the picture full screen at once, from the thumbnail already on the page, then sharpens it. The next pictures are loaded ahead of time and more pins keep loading behind the viewer.
- **Scroll down for more.** Under the picture is a grid of pins. Click one to bring it to the front. The grid never reshuffles under your mouse.
- **Related pins switch.** The button at the top right ("Below: this list" / "Below: related") chooses what the grid shows: the pins of the page you came from, or the related pins of the picture you are on, as if you had opened that pin. The same switch is in the toolbar popup.
- **Zoom.** Scroll up over the picture to zoom in, scroll down to zoom out (at normal size, scrolling down goes to the grid). Drag to move around while zoomed.
- **Videos and GIFs.** Videos play in the viewer with the normal controls. Space pauses. Clicking the middle of a video does not pause it; clicking outside it closes the viewer.
- **Like and Save.** A heart button and a board picker with a red Save button, using your signed-in session. The first time, click Pinterest's own board dropdown on any pin page once so the extension can learn how Pinterest lists your boards.
- **Open the real pin.** Click the picture or press Enter. On a pin page, clicking the big picture returns to the viewer.

Keys in the viewer: **A/W/Left** previous, **D/S/Right** next, **Space** pause video, **L** like, **Enter** open pin, **Esc** close. Keys are ignored while you type in a text field or hold Ctrl/Alt/Cmd/Shift.

## Install (Opera GX, Windows)

1. Download `SmoothPinterest.zip` from the latest [release](../../releases) and unzip it.
2. Double-click `SmoothPinterest.exe`. It installs itself to `%LOCALAPPDATA%\Smooth Pinterest\App` and puts the extension folder path on your clipboard.
3. First time only: open `opera://extensions`, turn on **Developer mode**, click **Load unpacked**, press Ctrl+V and Enter. (Opera GX cannot load extensions from the command line.)
4. Open Pinterest and click any pin.

## Updates

The extension checks this repository's releases every 6 hours. Click the toolbar icon for **Check for updates**, **Update now** and an **Update automatically** switch (on by default). The helper downloads the release zip, verifies the SHA-256 of `SmoothPinterest.exe` against the hash listed in the release notes, swaps the files and reloads the extension. It only accepts downloads from this repository's releases, and it runs only while an update is applied.

The hash check protects against corrupt downloads, not against a compromised repository.

## Troubleshooting

The toolbar popup has **Copy diagnostics**. Paste its output into an issue. Bug reports, ideas and feature requests are welcome.

## Uninstall

Remove the extension in `opera://extensions`, run `SmoothPinterest.exe /unregister`, then delete `%LOCALAPPDATA%\Smooth Pinterest`.

## Build

Needs AutoHotkey v2 with its compiler and Python 3. Run `python build.py`. It writes `dist/SmoothPinterest.zip` and prints the SHA-256 to paste into the release notes as `SmoothPinterest.exe SHA-256: <hex>`. The release asset must be named `SmoothPinterest.zip`.

## License

GPL-3.0. Made with AI assistance.
