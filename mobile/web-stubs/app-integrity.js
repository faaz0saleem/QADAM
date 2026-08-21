// §6.1 — Play Integrity and App Attest are device attestation. A browser is not
// a device we can attest, and pretending otherwise would be the one thing this
// module exists to prevent. Returning null means "unattested", which the server
// already knows how to price: at zero.
module.exports = {
  __esModule: true,
  attestKey: async () => null,
  generateKey: async () => null,
  prepareIntegrityTokenProvider: async () => null,
  requestIntegrityToken: async () => null,
};
