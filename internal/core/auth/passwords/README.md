# Password denylist provenance

`breached.txt` is the 46,528-entry filtered list used by OpenDesk. It contains the common
passwords with a length of 8–128 characters from the NCSC 100,000 most-used-password list.
The list is sourced from [SecLists](https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt).

The filtering and comparison behavior is described in OpenDesk's Apache-2.0 licensed
`internal/core/auth/passwords/README.md`; the license text is included at
`../../../../licenses/opendesk-apache-2.0.txt`.
