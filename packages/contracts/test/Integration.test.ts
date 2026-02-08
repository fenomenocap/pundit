import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployFixture, usdc } from "./helpers";

describe("Integration: full lifecycle", function () {
  it("deploy → create → trade → resolve → warp → claim → verify balances exactly", async function () {
    const {
      owner,
      alice,
      bob,
      charlie,
      usdc: usdcToken,
      vault,
      factory,
      resolver,
      engine,
    } = await loadFixture(deployFixture);

    const ONE_MILLION = usdc(1_000_000);

    // ── Step 1: Verify initial state ────────────────────────────────
    expect(await usdcToken.balanceOf(alice.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(bob.address)).to.equal(ONE_MILLION);
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(ONE_MILLION);
    expect(await factory.nextMarketId()).to.equal(0n);

    // ── Step 2: Create market ───────────────────────────────────────
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await factory.createMarket(
      "Will Brazil beat Germany in the Final?",
      ["Brazil wins", "Germany wins or Draw"],
      now + 86400 // resolves in 24h
    );
    expect(await factory.nextMarketId()).to.equal(1n);
    const market = await factory.getMarket(0n);
    expect(market.status).to.equal(0); // Open

    // ── Step 3: Three users trade ───────────────────────────────────
    //   Alice:   300 USDC on YES (outcome 0)
    //   Bob:     200 USDC on YES (outcome 0)
    //   Charlie: 500 USDC on NO  (outcome 1)
    await engine.connect(alice).buyShares(0n, 0, usdc(300));
    await engine.connect(bob).buyShares(0n, 0, usdc(200));
    await engine.connect(charlie).buyShares(0n, 1, usdc(500));

    // Verify USDC moved from users to vault
    expect(await usdcToken.balanceOf(alice.address)).to.equal(
      ONE_MILLION - usdc(300)
    );
    expect(await usdcToken.balanceOf(bob.address)).to.equal(
      ONE_MILLION - usdc(200)
    );
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(
      ONE_MILLION - usdc(500)
    );
    expect(await usdcToken.balanceOf(await vault.getAddress())).to.equal(
      usdc(1000)
    );

    // Pool state
    expect(await engine.totalPool(0n)).to.equal(usdc(1000));
    expect(await engine.totalSharesByOutcome(0n, 0)).to.equal(usdc(500));
    expect(await engine.totalSharesByOutcome(0n, 1)).to.equal(usdc(500));

    // ── Step 4: Resolve — Brazil wins (outcome 0) ───────────────────
    await resolver.resolve(0n, 0);
    expect((await factory.getMarket(0n)).status).to.equal(2); // Resolved
    expect(await factory.getResolvedOutcome(0n)).to.equal(0);

    // ── Step 5: Cannot claim yet (settlement delay) ─────────────────
    await expect(
      engine.connect(alice).claimWinnings(0n)
    ).to.be.revertedWithCustomError(engine, "MarketNotSettled");

    // ── Step 6: Warp past 30-min settlement delay ───────────────────
    await time.increase(1801);

    // ── Step 7: Winners claim ───────────────────────────────────────
    // Fee  = ceil(1000_000000 * 200 / 10000) = 20_000000 (20 USDC)
    // Net  = 1000_000000 - 20_000000 = 980_000000
    // Alice:  floor(300_000000 * 980_000000 / 500_000000) = 588_000000
    // Bob:    floor(200_000000 * 980_000000 / 500_000000) = 392_000000

    const aliceBefore = await usdcToken.balanceOf(alice.address);
    const bobBefore = await usdcToken.balanceOf(bob.address);

    const aliceTx = await engine.connect(alice).claimWinnings(0n);
    await expect(aliceTx)
      .to.emit(engine, "WinningsClaimed")
      .withArgs(0n, alice.address, usdc(588));

    const bobTx = await engine.connect(bob).claimWinnings(0n);
    await expect(bobTx)
      .to.emit(engine, "WinningsClaimed")
      .withArgs(0n, bob.address, usdc(392));

    // Exact payout verification
    expect(
      (await usdcToken.balanceOf(alice.address)) - aliceBefore
    ).to.equal(usdc(588));
    expect(
      (await usdcToken.balanceOf(bob.address)) - bobBefore
    ).to.equal(usdc(392));

    // ── Step 8: Charlie (loser) cannot claim ────────────────────────
    await expect(
      engine.connect(charlie).claimWinnings(0n)
    ).to.be.revertedWithCustomError(engine, "NothingToClaim");

    // ── Step 9: Double-claim prevention ─────────────────────────────
    await expect(
      engine.connect(alice).claimWinnings(0n)
    ).to.be.revertedWithCustomError(engine, "AlreadyClaimed");

    // ── Step 10: Final balance verification ─────────────────────────
    // Alice final:  1M - 300 + 588 = 1_000_288 USDC
    // Bob final:    1M - 200 + 392 = 1_000_192 USDC
    // Charlie final: 1M - 500      = 999_500 USDC (lost everything)
    expect(await usdcToken.balanceOf(alice.address)).to.equal(usdc(1_000_288));
    expect(await usdcToken.balanceOf(bob.address)).to.equal(usdc(1_000_192));
    expect(await usdcToken.balanceOf(charlie.address)).to.equal(usdc(999_500));

    // Vault holds ONLY the 20 USDC platform fee — nothing more, nothing less
    expect(await usdcToken.balanceOf(await vault.getAddress())).to.equal(
      usdc(20)
    );

    // ── Accounting check: all USDC accounted for ────────────────────
    const totalSupply = ONE_MILLION * 3n; // 3M total minted
    const aliceFinal = await usdcToken.balanceOf(alice.address);
    const bobFinal = await usdcToken.balanceOf(bob.address);
    const charlieFinal = await usdcToken.balanceOf(charlie.address);
    const vaultFinal = await usdcToken.balanceOf(await vault.getAddress());

    expect(aliceFinal + bobFinal + charlieFinal + vaultFinal).to.equal(
      totalSupply
    );
  });
});
