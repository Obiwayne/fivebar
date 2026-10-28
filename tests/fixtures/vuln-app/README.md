# vuln-app: a deliberately vulnerable test app

This folder is a target for Fivebar's tests and demo. Every problem in it is on purpose: SQL built from a template
string, `innerHTML` set from a variable, `eval()`, an old lodash with known advisories, and two keys in `src/config.js`.

The keys are fake. They are random strings in the format of a Stripe key and a GitHub token, so that Gitleaks has
something to find. They were never issued by Stripe or GitHub and unlock nothing. Don't copy anything here into a real
project.
