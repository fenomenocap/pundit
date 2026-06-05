import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture, createDefaultMarket, usdc } from "./helpers";

describe("ParimutuelEngine", function () {
  // ─── Basic buy flow ─────────────────────────────────────────────────

  describe("buyShares", function () {
    it("basic buy: pool updates and shares credited", async function () {
      const { factory, engine, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await engine.connect(alice).buyShares(0n, 0, usdc(100)); // 100 USDC gross on YES

      // fee = ceil(100e6 * 200 / 10000) = 2e6; net = 98e6
      expect(await engine.totalPool(0n)).to.equal(98_000_000n);
      expect(await engine.totalSharesByOutcome(0n, 0)).to.equal(98_000_000n);
      expect(await engine.totalSharesByOutcome(0n, 1)).to.equal(0n);
      expect(await engine.getUserShares(0n, alice.address, 0)).to.equal(98_000_000n);
    });

    it("multi-user: 3 users buy, all pool sizes correct", async function () {
      const { factory, engine, alice, bob, charlie } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await engine.connect(alice).buyShares(0n, 0, usdc(300));   // Alice: 300 YES gross → net 294
      await engine.connect(bob).buyShares(0n, 0, usdc(200));     // Bob:   200 YES gross → net 196
      await engine.connect(charlie).buyShares(0n, 1, usdc(500)); // Charlie: 500 NO  gross → net 490

      // All pools/shares track net amounts (after per-trade 2% fee)
      expect(await engine.totalPool(0n)).to.equal(980_000_000n);
      expect(await engine.totalSharesByOutcome(0n, 0)).to.equal(490_000_000n); // YES net
      expect(await engine.totalSharesByOutcome(0n, 1)).to.equal(490_000_000n); // NO net
      expect(await engine.getUserShares(0n, alice.address, 0)).to.equal(294_000_000n);
      expect(await engine.getUserShares(0n, bob.address, 0)).to.equal(196_000_000n);
      expect(await engine.getUserShares(0n, charlie.address, 1)).to.equal(490_000_000n);
    });

    it("emits SharesPurchased event", async function () {
      const { factory, engine, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // fee = ceil(50e6 * 200 / 10000) = 1e6; netShares = 49e6
      await expect(engine.connect(alice).buyShares(0n, 0, usdc(50)))
        .to.emit(engine, "SharesPurchased")
        .withArgs(0n, alice.address, 0, usdc(50), 49_000_000n);
    });

    it("reverts on zero amount", async function () {
      const { factory, engine, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await expect(
        engine.connect(alice).buyShares(0n, 0, 0n)
      ).to.be.revertedWithCustomError(engine, "ZeroAmount");
    });

    it("reverts on invalid outcome > 2", async function () {
      const { factory, engine, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Contract allows 0 (Yes/Home), 1 (No/Away), 2 (Draw). Outcome 3+ is invalid.
      await expect(
        engine.connect(alice).buyShares(0n, 3, usdc(100))
      ).to.be.revertedWithCustomError(engine, "InvalidOutcome");
    });

    it("reverts when market is not open (resolved)", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await time.increase(3601);
      await resolver.resolve(0n, 0);

      await expect(
        engine.connect(alice).buyShares(0n, 0, usdc(100))
      ).to.be.revertedWithCustomError(engine, "MarketNotOpen");
    });

    it("reverts when market is paused (locked)", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await resolver.pause(0n);

      await expect(
        engine.connect(alice).buyShares(0n, 0, usdc(100))
      ).to.be.revertedWithCustomError(engine, "MarketNotOpen");
    });
  });

  // ─── Exact payout math ──────────────────────────────────────────────

  describe("exact payout math", function () {
    /**
     * Scenario:
     *   Alice  buys 300 USDC YES (outcome 0)
     *   Bob    buys 200 USDC YES (outcome 0)
     *   Charlie buys 500 USDC NO  (outcome 1)
     *
     *   Resolve: YES wins (outcome 0)
     *   Total pool  = 1000 USDC
     *   Fee         = ceil(1000 * 200 / 10000) = ceil(20) = 20 USDC
     *   Net pool    = 980 USDC
     *   Total YES   = 500 shares
     *   Alice payout  = floor(300 * 980 / 500) = floor(588) = 588 USDC
     *   Bob payout    = floor(200 * 980 / 500) = floor(392) = 392 USDC
     *   Total paid    = 980 USDC → 0 dust in this case
     */
    it("Alice gets 588, Bob gets 392 exactly", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, bob, charlie, vault } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Buy shares
      await engine.connect(alice).buyShares(0n, 0, usdc(300));
      await engine.connect(bob).buyShares(0n, 0, usdc(200));
      await engine.connect(charlie).buyShares(0n, 1, usdc(500));

      // Warp past resolution timestamp, resolve YES, warp past settlement delay
      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      // Record balances before claims
      const aliceBefore = await usdcToken.balanceOf(alice.address);
      const bobBefore = await usdcToken.balanceOf(bob.address);

      // Claim
      await engine.connect(alice).claimWinnings(0n);
      await engine.connect(bob).claimWinnings(0n);

      const aliceAfter = await usdcToken.balanceOf(alice.address);
      const bobAfter = await usdcToken.balanceOf(bob.address);

      // Exact amounts
      expect(aliceAfter - aliceBefore).to.equal(usdc(588));
      expect(bobAfter - bobBefore).to.equal(usdc(392));

      // Vault retains exactly the 20 USDC fee (no dust)
      const vaultBalance = await usdcToken.balanceOf(await vault.getAddress());
      expect(vaultBalance).to.equal(usdc(20));
    });
  });

  // ─── Settlement delay enforcement ───────────────────────────────────

  describe("settlement delay", function () {
    it("reverts claim before 30 minutes after resolution", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await time.increase(3601);
      await resolver.resolve(0n, 0);

      // Try to claim immediately
      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "MarketNotSettled");

      // ~29 min later — still reverts
      // Resolve was at T. First claim mined at T+1. time.increase(N) sets
      // the next block to T+1+N, but the claim TX itself adds +1 more block.
      // Need: T+1+N+1 < T+1800 → N < 1798. Use 1797.
      await time.increase(1797);
      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "MarketNotSettled");
    });

    it("succeeds after 30 minutes", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await time.increase(3601);
      await resolver.resolve(0n, 0);

      await time.increase(1801);
      await expect(engine.connect(alice).claimWinnings(0n)).to.not.be.reverted;
    });
  });

  // ─── Double-claim prevention ────────────────────────────────────────

  describe("double-claim prevention", function () {
    it("reverts on second claim", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      await engine.connect(alice).claimWinnings(0n);

      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "AlreadyClaimed");
    });
  });

  // ─── Claiming from losing side ──────────────────────────────────────

  describe("losing side", function () {
    it("loser cannot claim winnings", async function () {
      const { factory, engine, resolver, alice, bob } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100)); // YES
      await engine.connect(bob).buyShares(0n, 1, usdc(100));   // NO
      await time.increase(3601);
      await resolver.resolve(0n, 0); // YES wins
      await time.increase(1801);

      await expect(
        engine.connect(bob).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "NothingToClaim");
    });
  });

  // ─── Market not claimable ───────────────────────────────────────────

  describe("market not claimable", function () {
    it("reverts claim on open market", async function () {
      const { factory, engine, alice } = await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));

      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "MarketNotClaimable");
    });

    it("reverts claim on paused market", async function () {
      const { factory, engine, resolver, alice } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await resolver.pause(0n);

      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "MarketNotClaimable");
    });
  });

  // ─── Zero / tiny pool edge cases ────────────────────────────────────

  describe("edge cases", function () {
    it("1 USDC total pool — no underflow", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, vault } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await engine.connect(alice).buyShares(0n, 0, usdc(1)); // 1 USDC YES
      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      const before = await usdcToken.balanceOf(alice.address);
      await engine.connect(alice).claimWinnings(0n);
      const after = await usdcToken.balanceOf(alice.address);

      // fee = ceil(1_000_000 * 200 / 10000) = ceil(20_000) = 20_000 raw (0.02 USDC)
      // payout = floor(1_000_000 * (1_000_000 - 20_000) / 1_000_000) = 980_000
      expect(after - before).to.equal(980_000n);

      // Vault retains exactly the fee
      expect(await usdcToken.balanceOf(await vault.getAddress())).to.equal(
        20_000n
      );
    });

    it("zero winning shares → full refund to all participants", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, bob } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Both users bet on NO (outcome 1)
      await engine.connect(alice).buyShares(0n, 1, usdc(100));
      await engine.connect(bob).buyShares(0n, 1, usdc(200));

      // Resolve YES (outcome 0) — nobody bet on YES
      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      const aliceBefore = await usdcToken.balanceOf(alice.address);
      const bobBefore = await usdcToken.balanceOf(bob.address);

      await engine.connect(alice).claimWinnings(0n);
      await engine.connect(bob).claimWinnings(0n);

      // Refund = net deposit (gross - fee). fee=ceil(100e6*200/10000)=2e6, fee=ceil(200e6*200/10000)=4e6
      expect(
        (await usdcToken.balanceOf(alice.address)) - aliceBefore
      ).to.equal(98_000_000n);
      expect(
        (await usdcToken.balanceOf(bob.address)) - bobBefore
      ).to.equal(196_000_000n);
    });

    it("cancelled market → net deposit refund (fee non-refundable)", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, bob } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await engine.connect(bob).buyShares(0n, 1, usdc(200));
      await resolver.cancel(0n);

      const aliceBefore = await usdcToken.balanceOf(alice.address);
      const bobBefore = await usdcToken.balanceOf(bob.address);

      await engine.connect(alice).claimWinnings(0n);
      await engine.connect(bob).claimWinnings(0n);

      // Refund = net deposit (fee is non-refundable on cancellation per protocol design)
      // Alice: 100 gross → fee=2, net=98. Bob: 200 gross → fee=4, net=196.
      expect(
        (await usdcToken.balanceOf(alice.address)) - aliceBefore
      ).to.equal(98_000_000n);
      expect(
        (await usdcToken.balanceOf(bob.address)) - bobBefore
      ).to.equal(196_000_000n);
    });

    it("user with no shares cannot claim from cancelled market", async function () {
      const { factory, engine, resolver, alice, stranger } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);
      await engine.connect(alice).buyShares(0n, 0, usdc(100));
      await resolver.cancel(0n);

      await expect(
        engine.connect(stranger).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "NothingToClaim");
    });
  });

  // ─── Rounding / dust ────────────────────────────────────────────────

  describe("rounding and dust", function () {
    it("dust stays in vault, never distributed", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, bob, charlie, vault } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Scenario where division produces a remainder:
      // Alice: 1 USDC YES, Bob: 1 USDC YES, Charlie: 1 USDC YES (winningPool=3)
      // Someone (alice again via a second buy): 8 USDC NO → totalPool = 11
      //
      // fee     = ceil(11_000000 * 200 / 10000) = ceil(220000.0) = 220000
      // netPool = 10_780_000
      // Each winner: floor(1_000000 * 10_780000 / 3_000000)
      //            = floor(3_593_333.33) = 3_593_333
      // Total paid  = 3 * 3_593_333 = 10_779_999
      // Vault holds  = 11_000_000 - 10_779_999 = 220_001 (fee 220_000 + 1 dust)
      await engine.connect(alice).buyShares(0n, 0, usdc(1));
      await engine.connect(bob).buyShares(0n, 0, usdc(1));
      await engine.connect(charlie).buyShares(0n, 0, usdc(1));
      await engine.connect(charlie).buyShares(0n, 1, usdc(8)); // loser side

      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      await engine.connect(alice).claimWinnings(0n);
      await engine.connect(bob).claimWinnings(0n);
      await engine.connect(charlie).claimWinnings(0n);

      // Vault holds: fee (220_000) + dust (1) = 220_001
      const vaultBal = await usdcToken.balanceOf(await vault.getAddress());
      expect(vaultBal).to.equal(220_001n);
      // Confirm dust > 0: vault holds MORE than just the fee
      expect(vaultBal).to.be.greaterThan(220_000n);
    });

    it("fee rounds UP in protocol's favor", async function () {
      const { factory, engine, resolver, usdc: usdcToken, alice, vault } =
        await loadFixture(deployFixture);
      await createDefaultMarket(factory);

      // Pool = 1 raw unit (smallest possible). fee = ceil(1 * 200 / 10000)
      // = ceil(0.02) = 1. Net = 0. Payout = 0. The full 1 unit is fee.
      await engine.connect(alice).buyShares(0n, 0, 1n);
      await time.increase(3601);
      await resolver.resolve(0n, 0);
      await time.increase(1801);

      // Payout = floor(1 * (1 - 1) / 1) = 0 → NothingToClaim
      await expect(
        engine.connect(alice).claimWinnings(0n)
      ).to.be.revertedWithCustomError(engine, "NothingToClaim");

      // Vault retains the 1 raw unit
      expect(await usdcToken.balanceOf(await vault.getAddress())).to.equal(1n);
    });
  });
});
