import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture, createDefaultMarket } from "./helpers";

describe("MarketFactory", function () {
  describe("market creation", function () {
    it("creates a market with correct data", async function () {
      const { factory } = await loadFixture(deployFixture);
      const { marketId } = await createDefaultMarket(factory);

      const market = await factory.getMarket(marketId);
      expect(market.question).to.equal("Will Brazil win?");
      expect(market.outcomes[0]).to.equal("Yes");
      expect(market.outcomes[1]).to.equal("No");
      expect(market.status).to.equal(0); // Open
    });

    it("auto-increments market IDs", async function () {
      const { factory } = await loadFixture(deployFixture);
      expect(await factory.nextMarketId()).to.equal(0n);

      await createDefaultMarket(factory);
      expect(await factory.nextMarketId()).to.equal(1n);

      // Create a second market
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await factory.createMarket("Will Argentina win?", ["Yes", "No"], now + 7200);
      expect(await factory.nextMarketId()).to.equal(2n);
    });

    it("emits MarketCreated event", async function () {
      const { factory } = await loadFixture(deployFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const resTs = now + 3600;

      await expect(factory.createMarket("Test?", ["A", "B"], resTs))
        .to.emit(factory, "MarketCreated")
        .withArgs(0n, "Test?", ["A", "B"], resTs);
    });

    it("reverts if resolution timestamp is in the past", async function () {
      const { factory } = await loadFixture(deployFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await expect(
        factory.createMarket("Q?", ["Y", "N"], now - 1)
      ).to.be.revertedWithCustomError(factory, "InvalidResolutionTimestamp");
    });

    it("reverts if non-owner creates a market", async function () {
      const { factory, alice } = await loadFixture(deployFixture);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      await expect(
        factory.connect(alice).createMarket("Q?", ["Y", "N"], now + 3600)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("reverts on getMarket with non-existent ID", async function () {
      const { factory } = await loadFixture(deployFixture);
      await expect(factory.getMarket(999n)).to.be.revertedWithCustomError(
        factory,
        "MarketNotFound"
      );
    });
  });

  describe("resolver access control", function () {
    it("only resolver can call resolveMarket", async function () {
      const { factory, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        factory.connect(alice).resolveMarket(0n, 0)
      ).to.be.revertedWithCustomError(factory, "NotResolver");
    });

    it("only resolver can call pauseMarket", async function () {
      const { factory, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        factory.connect(alice).pauseMarket(0n)
      ).to.be.revertedWithCustomError(factory, "NotResolver");
    });

    it("owner can set resolver", async function () {
      const { factory, alice } = await loadFixture(deployFixture);
      await factory.setResolver(alice.address);
      expect(await factory.resolver()).to.equal(alice.address);
    });

    it("non-owner cannot set resolver", async function () {
      const { factory, alice } = await loadFixture(deployFixture);
      await expect(
        factory.connect(alice).setResolver(alice.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });
});
