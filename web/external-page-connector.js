// Copy this alongside the reviewed VDO.Ninja SDK 1.5.5 in an experiment's
// controller. Pass it as VdoNinjaTransport's sdkFactory inside Connect.
export function createEmbeddedVdoSdk(options) {
  if (typeof globalThis.VDONinjaSDK !== "function") {
    throw new Error("Load the pinned VDO.Ninja SDK before connecting.");
  }
  const sdk = new globalThis.VDONinjaSDK(options);
  let storageAvailable = false;
  try { storageAvailable = Boolean(globalThis.localStorage); } catch { /* Opaque iframe origin. */ }
  if (!storageAvailable) {
    // SDK 1.5.5 checks typeof localStorage outside its try/catch. These cache
    // hooks are deliberately pinned; requalify them when upgrading the SDK.
    if (typeof sdk._getStorage !== "function" || typeof sdk._setStorage !== "function") {
      throw new Error("This connector requires the reviewed VDO.Ninja SDK 1.5.5 cache API.");
    }
    sdk._getStorage = () => null;
    sdk._setStorage = () => {};
  }
  return sdk;
}
