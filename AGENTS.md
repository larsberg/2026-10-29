# Audio playback

The user prohibits playing this sketch in background or headless browsers that
they cannot close. Do not launch those browsers for audio testing. Use silent
Node tests and builds. Audible playback must remain in a visible, user-controlled
tab or window. Never start hidden audio playback or bypass this restriction for
verification.

# Follow the reference sketch

When the user asks to follow a previous sketch, reuse its established controls,
settings, camera, and verification workflow before introducing another approach.
The reference for this sketch is `../2026-10-22`.

# Preferred browser connection: the existing VS Code tab

Browser Bridge (MCP) (`theozhao.vscode-browser-bridge`, version 0.2.9) is installed
and verified in the sketches VS Code window. Codex configuration includes the
`vscode_browser` MCP server. Prefer its native browser tools for the page the user
already has open inside VS Code.

Call `open_browser_page` with the sketch URL and leave `forceNew` false. For a
matching shared tab, it returns the existing page ID. Use that ID with `read_page`
and `screenshot_page`. This was verified against the existing sketch tab, including an actual screenshot
of its wireframe. The current dev URL is `http://127.0.0.1:1234/`.

Do not call `open_browser_page` without a URL to discover an existing tab through
this bridge: VS Code's sharing carousel needs a native VS Code Chat request that
an external MCP call lacks. That path can immediately return “The user opted not
to share an existing page” even when no picker appeared. Matching the URL of the
already-shared page worked.

The persistent stdio bridge is at:
`/Users/lars_berg/Library/Application Support/Code/User/globalStorage/theozhao.vscode-browser-bridge/stdio-bridge.mjs`.
Its documented `--discover` argument locates the VS Code window by workspace.
Discovery metadata and authentication stay in that extension's globalStorage;
never print its bearer token.

Visible, muted Chrome through CDP is the previously authorized fallback used by
`2026-10-13`. Prefer the existing VS Code tab now that its bridge is connected.
Do not invoke native desktop Computer Use merely to inspect an integrated browser
page; that requires separate macOS Accessibility and screenshot permissions.
