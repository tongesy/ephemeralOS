# Always-on display (Linux)

How to run ephemeralOS as a full-screen display that starts on boot, comes back if anything
crashes, and never sleeps. Written for [Omarchy](https://omarchy.org) (Arch and Hyprland) on a
laptop; other Hyprland or Wayland setups differ only in where autostart and idle are set.

[`deploy/linux/ephemeralos-kiosk`](../deploy/linux/ephemeralos-kiosk) starts the gateway, waits
for it, and opens Chromium in kiosk mode with a profile of its own. If either exits, it
restarts both, because a page only works with the launch token of the gateway that served it.
Logs go to `~/.local/state/ephemeralos/`.

## 1. Install

```sh
curl -fsSL https://raw.githubusercontent.com/tongesy/ephemeralos/main/scripts/install.sh | sh
```

This puts the app in `~/.local/share/ephemeralos/app` (with its own Node if yours is older
than 22.12) and asks for your keys. From a clone instead, run `pnpm install`,
`pnpm ephemeralos init` and `pnpm build`, and use the kiosk script from your clone; it uses
Node from mise when the installer's isn't there.

## 2. Try it

```sh
~/.local/share/ephemeralos/app/deploy/linux/ephemeralos-kiosk
```

The orb fills the screen. The first launch asks for the microphone once: allow it, and the
kiosk profile remembers. Audio starts without a click on every later launch. Say "Hey Jarvis".
Press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal to stop it (closing the window only
restarts it).

Pick the microphone and speakers in Omarchy's audio settings first if the defaults are wrong.
A USB speakerphone works far better across a room than laptop speakers.

## 3. Start it on login

Add to `~/.config/hypr/autostart.conf`:

```ini
exec-once = ~/.local/share/ephemeralos/app/deploy/linux/ephemeralos-kiosk
```

Omarchy logs in automatically after the disk-encryption password, so after a power cut the
display comes back once someone types that password.

## 4. Keep the screen on

Omarchy's idle daemon starts a screensaver, locks, then turns the display off. For a display
that is always on, remove the `listener { ... }` blocks from `~/.config/hypr/hypridle.conf`
(or only the ones you don't want), then restart it:

```sh
pkill hypridle; hypridle >/dev/null 2>&1 & disown
```

So it keeps running with the lid closed, or with a detachable screen off its base:

```sh
sudo mkdir -p /etc/systemd/logind.conf.d
sudo cp ~/.local/share/ephemeralos/app/deploy/linux/no-lid-sleep.conf /etc/systemd/logind.conf.d/
sudo systemctl kill -s HUP systemd-logind
```

## Updating

```sh
curl -fsSL https://raw.githubusercontent.com/tongesy/ephemeralos/main/scripts/install.sh | sh
pkill -f 'ephemeralos.mjs start'   # the kiosk restarts both on the new build
```

## Settings

| Variable      | Default                 | Use                        |
| ------------- | ----------------------- | -------------------------- |
| `EOS_PORT`    | `4317`                  | Port the gateway serves on |
| `EOS_BROWSER` | `chromium`, else Chrome | Browser to open            |
| `EOS_HOME`    | `~/.ephemeralos`        | Keys, persona, memory      |
