const {
  resolveMemoryDbPath,
  isSqliteVirtualPath,
} = require("../../src/shared/memory/storage/resolveMemoryDbPath");

describe("memory DB path resolver", () => {
  it("preserves SQLite in-memory sentinel paths", () => {
    expect(isSqliteVirtualPath(":memory:")).toBe(true);
    expect(resolveMemoryDbPath(":memory:")).toBe(":memory:");
  });
});