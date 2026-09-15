# Releases and signed updates

Use the release workflow manually after verification. Linux builds DEB and AppImage; Windows builds an x86_64 NSIS installer. No signing keys or publishing credentials are embedded. CI artifacts are test/release candidates, not evidence of Windows execution on a Linux host.

Local Linux: pnpm desktop:build --bundles deb,appimage.
Windows Developer PowerShell: pnpm desktop:build --bundles nsis.
Artifacts live under target/release/bundle; the Docker recipe uses target/linux/release/bundle.

The native association list includes only .nxd/.nxs/.nxp. Office defaults are not stolen. Tauri generates the application icon, desktop entry, MIME integration and NSIS Start Menu/Open With registration. Check installation/uninstallation in clean Windows and Linux VMs before public distribution.

Production automatic updates are disabled. To activate them, generate a Tauri updater key pair outside the repository, store the private key/password in release secrets, embed only the public verification key, and configure an HTTPS endpoint serving signed artifacts. Use the official updater plugin; never turn off signature verification. Enable update checks only with an explicit user preference and a fully configured release channel. Code signing (Authenticode) is separate from updater signing and requires its own certificate. No unsigned self-update path is acceptable.

Keep build signing secrets out of logs. Publish checksums and license notices with packages. ARM64 and Flatpak are future packaging targets, not currently verified releases.

The updater plugin is gated by the Cargo feature `signed-updates`; it is not linked or initialized in normal builds. Copy `apps/desktop/src-tauri/tauri.updater.example.json` to a release-specific configuration outside source control, replace the public key and HTTPS endpoint, and build with `pnpm desktop:build --features signed-updates --config /absolute/path/to/release-config.json`. Provision `TAURI_SIGNING_PRIVATE_KEY` and its password only through release secrets. The example endpoint uses the reserved `.invalid` domain and is intentionally nonfunctional. No update check or installation occurs automatically; a future update UI must respect the saved preference and ask before restarting with unsaved work.
