# Web stubs

Three packages in this app have no web implementation at all: the Google Mobile
Ads SDK, Play Integrity / App Attest, and view-shot's native screenshot. They
are imported statically, so on web the bundle fails to resolve them long before
any of their code would have run.

`metro.config.js` points Metro at these files when `platform === 'web'`. They
exist so `npx expo start --web` can render the app for a preview — a design
review, a screenshot, a demo to somebody who has no phone in front of them.

They are NOT a web port. Each one refuses in the way its caller already handles:
the ad reports `unavailable`, attestation returns null (which the server treats
as an unattested submission and pays nothing for), and the share card says it
could not be captured. Nothing here fakes a success.
