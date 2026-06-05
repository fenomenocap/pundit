import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture, createDefaultMarket } from "./helpers";

describe("OracleResolver", function () {
  describe("access control", function () {
    it("only owner can resolve", async function () {
      const { factory, resolver, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        resolver.connect(alice).resolve(0n, 0)
      ).to.be.revertedWithCustomError(resolver, "OwnableUnauthorizedAccount");
    });

    it("only owner can pause", async function () {
      const { factory, resolver, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        resolver.connect(alice).pause(0n)
      ).to.be.revertedWithCustomError(resolver, "OwnableUnauthorizedAccount");
    });

    it("only owner can unpause", async function () {
      const { factory, resolver, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        resolver.connect(alice).unpause(0n)
      ).to.be.revertedWithCustomError(resolver, "OwnableUnauthorizedAccount");
    });

    it("only owner can cancel", async function () {
      const { factory, resolver, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        resolver.connect(alice).cancel(0n)
      ).to.be.revertedWithCustomError(resolver, "OwnableUnauthorizedAccount");
    });
  });

  describe("state transitions", function () {
    it("resolve sets Resolved status and outcome", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await time.increase(3601);
      await resolver.resolve(0n, 1);

      const market = await factory.getMarket(0n);
      expect(market.status).to.equal(2); // Resolved
      expect(market.resolvedOutcome).to.equal(1);
      expect(market.resolvedAt).to.be.greaterThan(0n);
    });

    it("resolve emits MarketResolved", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await time.increase(3601);
      await expect(resolver.resolve(0n, 0))
        .to.emit(resolver, "MarketResolved")
        .withArgs(0n, 0);
    });

    it("resolve reverts with invalid outcome > 2", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Contract allows outcomes 0 (Yes/Home), 1 (No/Away), 2 (Draw). 3+ is invalid.
      await expect(resolver.resolve(0n, 3)).to.be.revertedWithCustomError(
        resolver,
        "InvalidOutcome"
      );
    });

    it("pause sets Locked status", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await resolver.pause(0n);

      expect(await factory.getMarketStatus(0n)).to.equal(1); // Locked
    });

    it("unpause restores Open status", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await resolver.pause(0n);

      await resolver.unpause(0n);

      expect(await factory.getMarketStatus(0n)).to.equal(0); // Open
    });

    it("cancel sets Cancelled status", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await resolver.cancel(0n);

      expect(await factory.getMarketStatus(0n)).to.equal(3); // Cancelled
    });

    it("pause emits MarketPaused", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(resolver.pause(0n))
        .to.emit(resolver, "MarketPaused")
        .withArgs(0n);
    });

    it("cancel emits MarketCancelled", async function () {
      const { factory, resolver } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(resolver.cancel(0n))
        .to.emit(resolver, "MarketCancelled")
        .withArgs(0n);
    });
  });
});
