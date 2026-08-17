# Security policy

## Supported versions

Cornix Studio is currently preview software. Security fixes are applied to the latest
published release and the default development branch.

## Reporting a vulnerability

Please do not publish an exploitable vulnerability, malicious firmware sample, or
sensitive device information in a public issue.

Use GitHub's **Report a vulnerability** feature in the
[`Ponkan230/cornix-studio`](https://github.com/Ponkan230/cornix-studio/security)
repository. If private vulnerability reporting is not available, open a public issue
containing only a request for a private contact channel and no technical exploit details.

Include the affected version, Windows version, connection type, reproduction outline,
and expected impact. Do not include keyboard backups if they contain macros or other
personal data.

## Firmware safety

Cornix Studio validates UF2 structure and target information, but it cannot establish
the trustworthiness of every third-party firmware image. Only install firmware obtained
from a source you trust and keep both keyboard halves on the same firmware version.
