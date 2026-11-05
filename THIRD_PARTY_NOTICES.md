# Third-party notices

## QR code generator

Panel sharing bundles qrcode-generator 2.0.4 (MIT). Generation runs locally.
Its license is included beside the vendored module.

- Source: https://github.com/kazuhikoarase/qrcode-generator

## Respyra observer panel

`companion/panels/respyra/` contains generated static assets from Respyra 2.0,
with exact source revision in `source.json`. Transport, QR, typography and font
licenses/provenance are included in its vendor directory. No experiment data
or private invitations are shipped.

## LabRecorder and liblsl

Remote LSL Recorder supervises the unmodified `LabRecorderCLI.exe` and
`lsl.dll` from the official LabStreamingLayer LabRecorder 1.18.0 Windows
release. The downloaded archive includes its license and upstream README.

- Source: https://github.com/labstreaminglayer/App-LabRecorder
- Release: https://github.com/labstreaminglayer/App-LabRecorder/releases/tag/v1.18.0
- License: MIT (included beside the downloaded binaries)

## labstream

The live viewer uses the `labstream` Rust crate version 0.1.0 under the MIT
license.

- Source: https://github.com/rednayan/labstream-rs
- Package: https://crates.io/crates/labstream/0.1.0

## VDO.Ninja SDK

The optional browser companion uses the vendored VDO.Ninja SDK 1.5.5 under
MPL-2.0. The corresponding license and notice are stored with the vendored
browser asset.

## Pretext and Noto Sans

The desktop and phone interfaces bundle Pretext 0.0.9 for bounded label
measurement (MIT) and Noto Sans 5.2.8 font files (SIL Open Font License 1.1).
Their license files are included beside each vendored browser asset.

- Pretext: https://github.com/chenglou/pretext
- Noto Sans: https://github.com/fontsource/fontsource/tree/main/packages/noto-sans

## Tauri NSIS installer template

`src-tauri/installer.nsi` adapts the MIT-licensed template from Tauri CLI
2.11.4, commit `8909f221d1515955fc843808032bdc5d62209c96`. The local
adaptation removes maintenance execution of previous uninstallers. The separate
hook rejects running Recorder processes instead of terminating them.

- Source: https://github.com/tauri-apps/tauri/blob/8909f221d1515955fc843808032bdc5d62209c96/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
- License: MIT (verbatim upstream text follows)
MIT License

Copyright (c) 2017 - Present Tauri Apps Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
