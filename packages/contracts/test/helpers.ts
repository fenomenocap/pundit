import { ethers } from "hardhat";

/**
 * Shared test fixture: deploys all contracts, mints 1M USDC to 3 users,
 * wires everything together (vault authorized, factory resolver set).
 */
export async function deployFixture() {
  const [owner, alice, bob, charlie, stranger] = await ethers.getSigners();

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  // Deploy CollateralVault
  const CollateralVault = await ethers.getContractFactory("CollateralVault");
  const vault = await CollateralVault.deploy(
    await usdc.getAddress(),
    owner.address
  );

  // Deploy MarketFactory
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const factory = await MarketFactory.deploy(owner.address);

  // Deploy OracleResolver
  const OracleResolver = await ethers.getContractFactory("OracleResolver");
  const resolver = await OracleResolver.deploy(
    await factory.getAddress(),
    owner.address
  );

  // Deploy ParimutuelEngine (2% fee = 200 bps, 30 min = 1800s settlement delay)
  const ParimutuelEngine = await ethers.getContractFactory("ParimutuelEngine");
  const engine = await ParimutuelEngine.deploy(
    await factory.getAddress(),
    await vault.getAddress(),
    200n,
    1800n,
    owner.address
  );

  // Wire: set resolver on factory, authorize engine on vault
  await factory.setResolver(await resolver.getAddress());
  await vault.setAuthorized(await engine.getAddress(), true);

  // Mint 1M USDC to each test user (1_000_000 * 10^6 = 1_000_000_000_000)
  const ONE_MILLION_USDC = 1_000_000n * 1_000_000n;
  await usdc.mint(alice.address, ONE_MILLION_USDC);
  await usdc.mint(bob.address, ONE_MILLION_USDC);
  await usdc.mint(charlie.address, ONE_MILLION_USDC);

  // Users approve vault to spend their USDC
  const MAX_UINT256 = ethers.MaxUint256;
  await usdc.connect(alice).approve(await vault.getAddress(), MAX_UINT256);
  await usdc.connect(bob).approve(await vault.getAddress(), MAX_UINT256);
  await usdc.connect(charlie).approve(await vault.getAddress(), MAX_UINT256);

  return {
    owner,
    alice,
    bob,
    charlie,
    stranger,
    usdc,
    vault,
    factory,
    resolver,
    engine,
  };
}

/** Helper: create a market that resolves 1 hour from now */
export async function createDefaultMarket(
  factory: Awaited<ReturnType<typeof deployFixture>>["factory"]
) {
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const resolutionTimestamp = now + 3600; // 1 hour from now
  const tx = await factory.createMarket(
    "Will Brazil win?",
    ["Yes", "No"],
    resolutionTimestamp
  );
  await tx.wait();
  return { marketId: 0n, resolutionTimestamp };
}

/** Convenience: USDC amounts (6 decimals) */
export function usdc(amount: number): bigint {
  return BigInt(amount) * 1_000_000n;
}
