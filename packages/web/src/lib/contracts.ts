// ─── Contract ABIs ────────────────────────────────────────────────────────────
// Imported from @sports-predict/shared — single source of truth.
// Do NOT duplicate ABI definitions here.

export {
  parimutuelEngineAbi,
  marketFactoryAbi,
  erc20Abi,
  collateralVaultAbi,
} from "@sports-predict/shared";

// ─── Contract addresses ───────────────────────────────────────────────────────
// Set via environment variables after deployment.
// Defaults match local anvil deployment from `pnpm deploy:local`.

export const CONTRACTS = {
  engine:  (process.env.NEXT_PUBLIC_ENGINE_ADDRESS  ?? "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9") as `0x${string}`,
  factory: (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as `0x${string}`,
  vault:   (process.env.NEXT_PUBLIC_VAULT_ADDRESS   ?? "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as `0x${string}`,
  usdc:    (process.env.NEXT_PUBLIC_USDC_ADDRESS    ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3") as `0x${string}`,
} as const;

export const EXPLORER_BASE = "https://sepolia.basescan.org";
