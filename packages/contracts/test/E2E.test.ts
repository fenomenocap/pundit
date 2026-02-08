import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture, usdc } from "./helpers";

/**
 * End-to-end integration test:
 *   1. Deploy all contracts
 *   2. Create a market
 *   3. 3 users trade (buy shares on both outcomes)
 *   4. Resolve the market
 *   5. Fast-forward past settlement delay
 *   6. Winners claim winnings, losers get NothingToClaim
 *   7. Verify final balances match expected math EXACTLY
 *   8. Verify vault holds exactly the protocol fee
 */
describe("E2E: Full Lifecycle", function () {
  it("deploy → trade → resolve → claim → verify balances exactly", async function () {
    // ─── 1. Deploy ────────────────────────────────────────────────────
    const { owner, alice, bob, charlie, usdc: usdcToken, vault, factory, resolver, engine } =
      await deployFixture();

    const ONE_MILLION = usdc(1_000_000);
    const vaultAddr = await vault.getAddress();

    // Confirm starting balances
    expect(await usdcToken.balanceOf(alice.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(bob.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(ONE_MILLION);

    // ─── 2. Create market ─────────────────────────────────────────────
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const resolutionTs = now + 3600; // 1 hour from now
    await factory.createMarket("Will Brazil win?", ["Yes", "No"], resolutionTs);

    const marketId = 0n;

    // ─── 3. Simulate 3 users trading ──────────────────────────────────
    //
    // Alice: 300 USDC on YES (outcome 0)
    // Bob:   200 USDC on YES (outcome 0)
    // Charlie: 500 USDC on NO (outcome 1)
    //
    // Total pool: 1,000 USDC
    // YES pool: 500, NO pool: 500

    await engine.connect(alice).buyShares(marketId, 0, usdc(300));
    await engine.connect(bob).buyShares(marketId, 0, usdc(200));
    await engine.connect(charlie).buyShares(marketId, 1, usdc(500));

    // Verify pool state
    expect(await engine.totalSharesByOutcome(marketId, 0)).to.equal(usdc(500)); // YES
    expect(await engine.totalSharesByOutcome(marketId, 1)).to.equal(usdc(500)); // NO
    expect(await engine.totalPool(marketId)).to.equal(usdc(1000));

    // Verify user shares
    expect(await engine.getUserShares(marketId, alice.address, 0)).to.equal(usdc(300));
    expect(await engine.getUserShares(marketId, bob.address, 0)).to.equal(usdc(200));
    expect(await engine.getUserShares(marketId, charlie.address, 1)).to.equal(usdc(500));

    // Verify vault holds 1000 USDC
    expect(await usdcToken.balanceOf(vaultAddr)).to.equal(usdc(1000));

    // ─── 4. Resolve: YES wins (outcome 0) ─────────────────────────────
    // Fast-forward past resolution timestamp
    await time.increaseTo(resolutionTs + 1);
    await resolver.resolve(marketId, 0);

    // Verify resolved state
    const market = await factory.getMarket(marketId);
    expect(market.status).to.equal(2); // MarketStatus.Resolved
    expect(market.resolvedOutcome).to.equal(0);

    // ─── 5. Fast-forward past settlement delay (1800s) ────────────────
    const resolvedAt = market.resolvedAt;
    await time.increaseTo(Number(resolvedAt) + 1800 + 1);

    // ─── 6. Compute expected payouts exactly ──────────────────────────
    //
    // Pool = 1,000 USDC = 1,000,000,000 raw
    // Fee = ceil(1,000,000,000 * 200 / 10,000) = ceil(20,000,000) = 20,000,000 (exact, no rounding needed)
    // Net pool = 1,000,000,000 - 20,000,000 = 980,000,000
    // Winning pool (YES) = 500,000,000
    //
    // Alice (300 YES): floor(300,000,000 * 980,000,000 / 500,000,000) = floor(588,000,000) = 588,000,000
    // Bob (200 YES):   floor(200,000,000 * 980,000,000 / 500,000,000) = floor(392,000,000) = 392,000,000
    // Charlie (500 NO): NothingToClaim
    //
    // Total payouts: 588,000,000 + 392,000,000 = 980,000,000
    // Fee retained: 20,000,000

    const POOL = usdc(1000);           // 1,000,000,000
    const FEE_BPS = 200n;
    const BPS = 10_000n;
    const fee = (POOL * FEE_BPS + BPS - 1n) / BPS; // ceil
    expect(fee).to.equal(20_000_000n);

    const netPool = POOL - fee;
    expect(netPool).to.equal(980_000_000n);

    const winningPool = usdc(500);     // 500,000,000

    const alicePayout = (usdc(300) * netPool) / winningPool;
    const bobPayout = (usdc(200) * netPool) / winningPool;
    expect(alicePayout).to.equal(588_000_000n);
    expect(bobPayout).to.equal(392_000_000n);

    // ─── 7. Claims ────────────────────────────────────────────────────

    // Alice claims
    await engine.connect(alice).claimWinnings(marketId);
    expect(await usdcToken.balanceOf(alice.address)).to.equal(
      ONE_MILLION - usdc(300) + alicePayout // 1M - 300 + 588 = 1,000,288 USDC
    );

    // Bob claims
    await engine.connect(bob).claimWinnings(marketId);
    expect(await usdcToken.balanceOf(bob.address)).to.equal(
      ONE_MILLION - usdc(200) + bobPayout // 1M - 200 + 392 = 1,000,192 USDC
    );

    // Charlie (loser) cannot claim
    await expect(
      engine.connect(charlie).claimWinnings(marketId)
    ).to.be.revertedWithCustomError(engine, "NothingToClaim");

    // Charlie's balance: original - 500 USDC spent (lost)
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(
      ONE_MILLION - usdc(500)
    );

    // Double-claim blocked
    await expect(
      engine.connect(alice).claimWinnings(marketId)
    ).to.be.revertedWithCustomError(engine, "AlreadyClaimed");

    // ─── 8. Verify vault holds exactly the fee ────────────────────────
    expect(await usdcToken.balanceOf(vaultAddr)).to.equal(fee);

    // ─── 9. Verify conservation of funds ──────────────────────────────
    // Total USDC in system = alice + bob + charlie + vault fee
    const aliceFinal = await usdcToken.balanceOf(alice.address);
    const bobFinal = await usdcToken.balanceOf(bob.address);
    const charlieFinal = await usdcToken.balanceOf(charlie.address);
    const vaultFinal = await usdcToken.balanceOf(vaultAddr);

    // Total should equal 3 * 1M USDC (total minted)
    expect(aliceFinal + bobFinal + charlieFinal + vaultFinal).to.equal(
      ONE_MILLION * 3n
    );

    console.log("  Final balances:");
    console.log(`    Alice:   ${ethers.formatUnits(aliceFinal, 6)} USDC (profit: +${ethers.formatUnits(alicePayout - usdc(300), 6)})`);
    console.log(`    Bob:     ${ethers.formatUnits(bobFinal, 6)} USDC (profit: +${ethers.formatUnits(bobPayout - usdc(200), 6)})`);
    console.log(`    Charlie: ${ethers.formatUnits(charlieFinal, 6)} USDC (loss: -${ethers.formatUnits(usdc(500), 6)})`);
    console.log(`    Vault:   ${ethers.formatUnits(vaultFinal, 6)} USDC (fee)`);
  });

  it("cancellation → all users get full refund, vault empty", async function () {
    const { alice, bob, charlie, usdc: usdcToken, vault, factory, resolver, engine } =
      await deployFixture();

    const ONE_MILLION = usdc(1_000_000);
    const vaultAddr = await vault.getAddress();

    // Create market
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await factory.createMarket("Will it rain?", ["Yes", "No"], now + 3600);

    const marketId = 0n;

    // Trade
    await engine.connect(alice).buyShares(marketId, 0, usdc(400));
    await engine.connect(bob).buyShares(marketId, 1, usdc(600));
    await engine.connect(charlie).buyShares(marketId, 0, usdc(200));

    expect(await usdcToken.balanceOf(vaultAddr)).to.equal(usdc(1200));

    // Cancel
    await resolver.cancel(marketId);

    // Everyone can claim full refund
    await engine.connect(alice).claimWinnings(marketId);
    await engine.connect(bob).claimWinnings(marketId);
    await engine.connect(charlie).claimWinnings(marketId);

    // Balances restored
    expect(await usdcToken.balanceOf(alice.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(bob.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(ONE_MILLION);

    // Vault empty
    expect(await usdcToken.balanceOf(vaultAddr)).to.equal(0n);
  });

  it("settlement delay enforced — claim before delay reverts", async function () {
    const { alice, usdc: usdcToken, vault, factory, resolver, engine } =
      await deployFixture();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await factory.createMarket("Test?", ["A", "B"], now + 3600);

    await engine.connect(alice).buyShares(0n, 0, usdc(100));

    // Resolve
    await time.increaseTo(now + 3601);
    await resolver.resolve(0n, 0);

    // Claim immediately — should fail (settlement delay not passed)
    await expect(
      engine.connect(alice).claimWinnings(0n)
    ).to.be.revertedWithCustomError(engine, "MarketNotSettled");

    // Fast-forward past settlement delay
    const resolvedAt = (await factory.getMarket(0n)).resolvedAt;
    await time.increaseTo(Number(resolvedAt) + 1801);

    // Now claim succeeds
    await engine.connect(alice).claimWinnings(0n);
  });

  it("multi-market scenario — users trade across markets independently", async function () {
    const { owner, alice, bob, charlie, usdc: usdcToken, vault, factory, resolver, engine } =
      await deployFixture();

    const ONE_MILLION = usdc(1_000_000);
    const vaultAddr = await vault.getAddress();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;

    // Create 2 markets
    await factory.createMarket("Market A?", ["Yes", "No"], now + 3600);
    await factory.createMarket("Market B?", ["Yes", "No"], now + 7200);

    // Market 0: Alice YES 1000, Bob NO 1000
    await engine.connect(alice).buyShares(0n, 0, usdc(1000));
    await engine.connect(bob).buyShares(0n, 1, usdc(1000));

    // Market 1: Bob YES 500, Charlie NO 500
    await engine.connect(bob).buyShares(1n, 0, usdc(500));
    await engine.connect(charlie).buyShares(1n, 1, usdc(500));

    // Resolve Market 0: YES wins
    await time.increaseTo(now + 3601);
    await resolver.resolve(0n, 0);

    // Resolve Market 1: NO wins
    await time.increaseTo(now + 7201);
    await resolver.resolve(1n, 1);

    // Fast-forward past both settlement delays
    const resolved1At = (await factory.getMarket(1n)).resolvedAt;
    await time.increaseTo(Number(resolved1At) + 1801);

    // Market 0: Alice wins (1000 YES, pool 2000, fee 40, net 1960, payout 1960)
    await engine.connect(alice).claimWinnings(0n);
    // Market 0: Bob loses
    await expect(
      engine.connect(bob).claimWinnings(0n)
    ).to.be.revertedWithCustomError(engine, "NothingToClaim");

    // Market 1: Charlie wins (500 NO, pool 1000, fee 20, net 980, payout 980)
    await engine.connect(charlie).claimWinnings(1n);
    // Market 1: Bob loses
    await expect(
      engine.connect(bob).claimWinnings(1n)
    ).to.be.revertedWithCustomError(engine, "NothingToClaim");

    // Verify final balances
    const aliceFinal = await usdcToken.balanceOf(alice.address);
    const bobFinal = await usdcToken.balanceOf(bob.address);
    const charlieFinal = await usdcToken.balanceOf(charlie.address);
    const vaultFinal = await usdcToken.balanceOf(vaultAddr);

    // Alice: 1M - 1000 + 1960 = 1,000,960
    expect(aliceFinal).to.equal(ONE_MILLION - usdc(1000) + 1_960_000_000n);
    // Bob: 1M - 1000 - 500 = 998,500 (lost both)
    expect(bobFinal).to.equal(ONE_MILLION - usdc(1000) - usdc(500));
    // Charlie: 1M - 500 + 980 = 1,000,480
    expect(charlieFinal).to.equal(ONE_MILLION - usdc(500) + 980_000_000n);
    // Vault: fee from M0 (40) + fee from M1 (20) = 60 USDC
    expect(vaultFinal).to.equal(usdc(60));

    // Conservation
    expect(aliceFinal + bobFinal + charlieFinal + vaultFinal).to.equal(ONE_MILLION * 3n);
  });
});
