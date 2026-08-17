# Contributing to Cornix Studio

Thank you for helping improve Cornix Studio.

## Before opening a change

1. Search existing issues and pull requests.
2. Test against demo mode when hardware is not required.
3. Do not include keyboard backups, Bluetooth identifiers, local paths, firmware files,
   credentials, or other personal data.
4. Keep Cornix Studio clearly identified as an unofficial community project.

## Development checks

Run the following from the repository root on Windows:

```text
studio\scripts\build.cmd
```

This builds the frontend, formats/checks Rust code, runs the Rust tests, and creates the
standalone Windows executable.

## Licensing contributions

Contributions are accepted under `GPL-2.0-or-later`, matching the repository license.
By submitting a contribution, you confirm that you have the right to license it under
those terms. Preserve existing copyright, SPDX, attribution, and modification notices.

Do not submit Cornix firmware binaries or third-party assets unless their redistribution
terms are documented and compatible with this project.
