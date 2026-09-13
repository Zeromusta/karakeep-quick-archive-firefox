// Identical preprocessing and assembly options preserve SingleFile's DOM markers.
export const captureOptions = {
  removeHiddenElements: true, removeUnusedStyles: true, removeUnusedFonts: true,
  compressHTML: true, blockScripts: true, blockVideos: true, blockAudios: true,
  removeFrames: true, removeAlternativeFonts: true, removeAlternativeMedias: true,
  removeAlternativeImages: true, groupDuplicateImages: true,
  maxResourceSizeEnabled: true, maxResourceSize: 8, networkTimeout: 8000,
  loadDeferredImages: false, saveOriginalURLs: true
};
