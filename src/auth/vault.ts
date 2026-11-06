/**
 * Tokens in the iOS Keychain or Android Keystore, readable only on this device while it is
 * unlocked, never backed up or moved to another device. Apps with PHI also ask for Face ID, Touch ID
 * or the device's fingerprint each time the app reads them (at launch).
 */
import * as SecureStore from "expo-secure-store";
import type { Tokens, Vault } from "./session";

const KEY = "session";

export function secureVault(phi: boolean): Vault {
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: phi && SecureStore.canUseBiometricAuthentication(),
    authenticationPrompt: "Unlock your saved sign-in",
  };
  return {
    async load() {
      const json = await SecureStore.getItemAsync(KEY, options);
      return json ? (JSON.parse(json) as Tokens) : null;
    },
    save: (tokens) => SecureStore.setItemAsync(KEY, JSON.stringify(tokens), options),
    clear: () => SecureStore.deleteItemAsync(KEY, options),
  };
}

/** For tests and previews. */
export function memoryVault(initial: Tokens | null = null): Vault & { tokens: Tokens | null } {
  const vault = {
    tokens: initial,
    load: () => Promise.resolve(vault.tokens),
    save: (tokens: Tokens) => {
      vault.tokens = tokens;
      return Promise.resolve();
    },
    clear: () => {
      vault.tokens = null;
      return Promise.resolve();
    },
  };
  return vault;
}
