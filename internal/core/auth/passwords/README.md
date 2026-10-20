# Password denylist

`breached.txt` is an embedded list of 46,528 common passwords selected from
the NCSC 100,000 most-used-password list. It contains entries 8–128 characters
long. Password checks compare entries case-insensitively after enforcing
Welio's password length limits.

The list is derived from the
[SecLists NCSC password list](https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt).
