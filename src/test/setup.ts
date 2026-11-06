// Native modules the app subscribes to at start; tests that care mock them themselves.
jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
