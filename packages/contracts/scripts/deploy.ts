import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );
  console.log("---");

  // 1. MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddr);

  // 2. MarketFactory
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const factory = await MarketFactory.deploy(deployer.address);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("MarketFactory deployed to:", factoryAddr);

  // 3. CollateralVault
  const CollateralVault = await ethers.getContractFactory("CollateralVault");
  const vault = await CollateralVault.deploy(usdcAddr, deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("CollateralVault deployed to:", vaultAddr);

  // 4. OracleResolver
  const OracleResolver = await ethers.getContractFactory("OracleResolver");
  const resolver = await OracleResolver.deploy(factoryAddr, deployer.address);
  await resolver.waitForDeployment();
  const resolverAddr = await resolver.getAddress();
  console.log("OracleResolver deployed to:", resolverAddr);

  // 5. ParimutuelEngine (2% fee = 200 bps, 30 min = 1800s settlement delay)
  const ParimutuelEngine = await ethers.getContractFactory("ParimutuelEngine");
  const engine = await ParimutuelEngine.deploy(
    factoryAddr,
    vaultAddr,
    200n,
    1800n
  );
  await engine.waitForDeployment();
  const engineAddr = await engine.getAddress();
  console.log("ParimutuelEngine deployed to:", engineAddr);

  // 6. Wire contracts together
  console.log("---");
  console.log("Wiring contracts...");

  await (await factory.setResolver(resolverAddr)).wait();
  console.log("  Factory resolver set to OracleResolver");

  await (await vault.setAuthorized(engineAddr, true)).wait();
  console.log("  Vault authorized ParimutuelEngine");

  // Save addresses to JSON
  const addresses = {
    deployer: deployer.address,
    MockUSDC: usdcAddr,
    MarketFactory: factoryAddr,
    CollateralVault: vaultAddr,
    OracleResolver: resolverAddr,
    ParimutuelEngine: engineAddr,
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("---");
  console.log("Addresses saved to:", outPath);
  console.log(JSON.stringify(addresses, null, 2));

  // Print env vars ready to copy into .env or Vercel dashboard
  console.log("\n=== Environment variables (copy to .env / Vercel) ===");
  console.log(`NEXT_PUBLIC_ENGINE_ADDRESS=${engineAddr}`);
  console.log(`NEXT_PUBLIC_FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${usdcAddr}`);
  console.log(`FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`ENGINE_ADDRESS=${engineAddr}`);
  console.log(`RESOLVER_ADDRESS=${resolverAddr}`);
  console.log(`USDC_ADDRESS=${usdcAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
