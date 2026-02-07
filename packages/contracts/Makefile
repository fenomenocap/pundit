.PHONY: build test clean deploy-local deploy-sepolia seed-local seed-sepolia verify-local node

# ── Build & Test ─────────────────────────────────────────────────────────────

build:
	npx hardhat compile

test:
	npx hardhat test

clean:
	npx hardhat clean
	rm -rf out cache typechain-types

# ── Local development (Hardhat node) ─────────────────────────────────────────

node:
	npx hardhat node

deploy-local:
	npx hardhat run scripts/deploy.ts --network localhost

seed-local:
	npx hardhat run scripts/seed.ts --network localhost

verify-local:
	npx hardhat run scripts/verify.ts --network localhost

# ── Base Sepolia ─────────────────────────────────────────────────────────────

deploy-sepolia:
	npx hardhat run scripts/deploy.ts --network base_sepolia

seed-sepolia:
	npx hardhat run scripts/seed.ts --network base_sepolia

# ── Convenience: full local flow ─────────────────────────────────────────────

local: deploy-local seed-local verify-local
