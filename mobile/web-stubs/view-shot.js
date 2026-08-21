// §7.6's shareable team card is a native screenshot of a rendered view. The
// browser equivalent needs canvas rasterisation and a different share sheet;
// on web the card renders and the capture reports failure, which the caller
// already surfaces.
module.exports = {
  __esModule: true,
  captureRef: async () => {
    throw new Error('view-shot is native only — the card renders, the capture does not');
  },
};
