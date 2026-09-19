import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (value?: string) => {
  vi.resetModules();
  if (value === undefined) delete process.env.HIDDEN_COINS;
  else process.env.HIDDEN_COINS = value;
  return (await import("./hidden")).isHidden;
};

describe("hidden coins", () => {
  afterEach(() => void delete process.env.HIDDEN_COINS);

  it("hides nothing when HIDDEN_COINS is unset", async () => {
    const isHidden = await load();
    expect(isHidden("Vault1", "Mint1")).toBe(false);
  });

  it("matches any listed vault or mint, with commas, spaces or newlines between them", async () => {
    const isHidden = await load(" Vault1,Mint2\nVault3 ");
    expect(isHidden("Vault1")).toBe(true);
    expect(isHidden("Other", "Mint2")).toBe(true);
    expect(isHidden(null, undefined, "Vault3")).toBe(true);
    expect(isHidden("Vault4", "Mint4")).toBe(false);
  });
});
