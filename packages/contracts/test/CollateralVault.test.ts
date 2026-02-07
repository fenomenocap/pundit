import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture } from "./helpers";

describe("CollateralVault", function () {
  describe("authorization", function () {
    it("owner can set authorized addresses", async function () {
      const { vault, stranger } = await loadFixture(deployFixture);
      await vault.setAuthorized(stranger.address, true);
      expect(await vault.authorized(stranger.address)).to.be.true;
    });

    it("owner can revoke authorization", async function () {
      const { vault, engine } = await loadFixture(deployFixture);
      await vault.setAuthorized(await engine.getAddress(), false);
      expect(await vault.authorized(await engine.getAddress())).to.be.false;
    });

    it("non-owner cannot set authorized", async function () {
      const { vault, alice, stranger } = await loadFixture(deployFixture);
      await expect(
        vault.connect(alice).setAuthorized(stranger.address, true)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("unauthorized address cannot depositFor", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(
        vault.connect(alice).depositFor(alice.address, 100n)
      ).to.be.revertedWithCustomError(vault, "NotAuthorized");
    });

    it("unauthorized address cannot withdrawTo", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(
        vault.connect(alice).withdrawTo(alice.address, 100n)
      ).to.be.revertedWithCustomError(vault, "NotAuthorized");
    });
  });

  describe("deposits and withdrawals", function () {
    it("reverts on zero amount deposit", async function () {
      const { vault, engine, alice } = await loadFixture(deployFixture);
      // Call via a newly authorized signer won't work directly
      // Test through engine which is authorized
      // Instead, authorize owner directly for this test
      const { owner, usdc } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await expect(
        vault.depositFor(owner.address, 0n)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts on zero amount withdrawal", async function () {
      const { vault, owner } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await expect(
        vault.withdrawTo(owner.address, 0n)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("depositFor transfers USDC into vault", async function () {
      const { vault, owner, usdc, alice } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await usdc.connect(alice).approve(await vault.getAddress(), 500n);

      await vault.depositFor(alice.address, 500n);

      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(500n);
    });

    it("withdrawTo sends USDC from vault", async function () {
      const { vault, owner, usdc, alice } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await usdc.connect(alice).approve(await vault.getAddress(), 500n);
      await vault.depositFor(alice.address, 500n);

      const balBefore = await usdc.balanceOf(alice.address);
      await vault.withdrawTo(alice.address, 500n);
      const balAfter = await usdc.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(500n);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(0n);
    });

    it("emits Deposited event", async function () {
      const { vault, owner, usdc, alice } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await usdc.connect(alice).approve(await vault.getAddress(), 100n);

      await expect(vault.depositFor(alice.address, 100n))
        .to.emit(vault, "Deposited")
        .withArgs(alice.address, 100n);
    });

    it("emits Withdrawn event", async function () {
      const { vault, owner, usdc, alice } = await loadFixture(deployFixture);
      await vault.setAuthorized(owner.address, true);
      await usdc.connect(alice).approve(await vault.getAddress(), 100n);
      await vault.depositFor(alice.address, 100n);

      await expect(vault.withdrawTo(alice.address, 100n))
        .to.emit(vault, "Withdrawn")
        .withArgs(alice.address, 100n);
    });
  });
});
