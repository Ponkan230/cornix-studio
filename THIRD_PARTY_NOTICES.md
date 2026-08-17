# Third-party notices

Cornix Studio is distributed under `GPL-2.0-or-later`. The complete license text is
available in [`COPYING`](COPYING).

## Vial GUI

Cornix Studio is based on and interoperates with concepts and protocol behavior from
[vial-kb/vial-gui](https://github.com/vial-kb/vial-gui).

- License: `GPL-2.0-or-later`
- Copyright: Vial GUI contributors
- Local upstream source: the repository root outside `studio/`

The Rust/Tauri application is a modified and substantially rewritten implementation.
The KLE parser in `studio/src/kle.ts` is derived in part from Vial GUI's
`kle_serial.py` state machine. Changes for Cornix Studio were made in 2026 by
Ponkan230 and Cornix Studio contributors.

## Direct Rust dependencies

| Component | License | Project |
| --- | --- | --- |
| Tauri / tauri-build | Apache-2.0 OR MIT | <https://github.com/tauri-apps/tauri> |
| hidapi | MIT | <https://github.com/ruabmbua/hidapi-rs> |
| serde / serde_json | Apache-2.0 OR MIT | <https://github.com/serde-rs/serde> |
| hex | Apache-2.0 OR MIT | <https://github.com/KokaKiwi/rust-hex> |
| xz2 | Apache-2.0 OR MIT | <https://github.com/alexcrichton/xz2-rs> |
| zip | MIT | <https://github.com/zip-rs/zip2> |

Exact Rust versions and transitive dependencies are recorded in
[`studio/src-tauri/Cargo.lock`](studio/src-tauri/Cargo.lock).

## Direct frontend and build dependencies

| Component | License | Project |
| --- | --- | --- |
| @tauri-apps/api | Apache-2.0 OR MIT | <https://github.com/tauri-apps/tauri> |
| @tauri-apps/cli | Apache-2.0 OR MIT | <https://github.com/tauri-apps/tauri> |
| TypeScript | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| Vite | MIT | <https://github.com/vitejs/vite> |

Exact npm versions, integrity hashes, transitive dependencies, and their declared
licenses are recorded in [`studio/package-lock.json`](studio/package-lock.json).

## Cornix compatibility fixture

`studio/src/fixtures/cornix-v1.12.json` contains a Vial-compatible device definition
used for offline demo and compatibility testing. It does not contain Cornix firmware,
cryptographic keys, or executable device code.

Cornix, Vial, Tauri, Windows, and all other product names are trademarks or registered
trademarks of their respective owners. Their use identifies compatibility only and
does not imply endorsement.
