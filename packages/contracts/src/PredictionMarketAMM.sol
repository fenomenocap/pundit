// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MarketFactory} from "./MarketFactory.sol";
import {CollateralVault} from "./CollateralVault.sol";

/// @title PredictionMarketAMM
/// @notice Constant-Product Market Maker (CPMM) for binary prediction markets.
///         Prices adjust dynamically based on supply and demand. Each outcome
///         token pays 1 USDC if the outcome wins, 0 otherwise.
///
/// Price model:
///   Price(YES) = noReserve  / (yesReserve + noReserve)
///   Price(NO)  = yesReserve / (yesReserve + noReserve)
///
/// Buy YES with `amount` USDC (after fee):
///   sharesOut = yesReserve * netAmount / (noReserve + netAmount)
///
/// Sell YES for USDC:
///   usdcOut = noReserve * shares / (yesReserve + shares)
contract PredictionMarketAMM is ReentrancyGuard {
    // ─── Constants ──────────────────────────────────────────────────────

    uint256 public immutable feeBps;          // e.g. 200 = 2%
    uint256 public immutable settlementDelay; // seconds after resolution before claims
    uint256 private constant BPS = 10_000;

    // ─── External references ────────────────────────────────────────────

    MarketFactory public immutable factory;
    CollateralVault public immutable vault;

    // ─── Pool state ─────────────────────────────────────────────────────

    struct Pool {
        uint256 yesReserve;  // AMM's YES token inventory
        uint256 noReserve;   // AMM's NO token inventory
        bool initialized;
    }

    mapping(uint256 => Pool) public pools;

    // ─── User balances ──────────────────────────────────────────────────

    mapping(uint256 => mapping(address => uint256)) public yesSharesOf;
    mapping(uint256 => mapping(address => uint256)) public noSharesOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    // ─── Accounting ─────────────────────────────────────────────────────

    mapping(uint256 => uint256) public collectedFees;
    mapping(uint256 => uint256) public totalVolume;

    // ─── Events ─────────────────────────────────────────────────────────

    event PoolInitialized(uint256 indexed marketId, uint256 initialLiquidity);

    event OutcomeBought(
        uint256 indexed marketId,
        address indexed buyer,
        uint8 outcome,
        uint256 usdcIn,
        uint256 sharesOut
    );

    event OutcomeSold(
        uint256 indexed marketId,
        address indexed seller,
        uint8 outcome,
        uint256 sharesIn,
        uint256 usdcOut
    );

    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed claimant,
        uint256 payout
    );

    // ─── Errors ─────────────────────────────────────────────────────────

    error MarketNotOpen();
    error InvalidOutcome();
    error ZeroAmount();
    error PoolAlreadyInitialized();
    error PoolNotInitialized();
    error InsufficientShares();
    error MarketNotSettled();
    error AlreadyClaimed();
    error NothingToClaim();
    error MarketNotClaimable();
    error SlippageExceeded();

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(
        address _factory,
        address _vault,
        uint256 _feeBps,
        uint256 _settlementDelay
    ) {
        factory = MarketFactory(_factory);
        vault = CollateralVault(_vault);
        feeBps = _feeBps;
        settlementDelay = _settlementDelay;
    }

    // ─── Pool Initialization ────────────────────────────────────────────

    /// @notice Seed the AMM pool with initial liquidity at 50/50 odds.
    /// @param marketId          Market to initialize.
    /// @param initialLiquidity  USDC to deposit (creates equal YES/NO reserves).
    function initializePool(
        uint256 marketId,
        uint256 initialLiquidity
    ) external nonReentrant {
        if (initialLiquidity == 0) revert ZeroAmount();

        Pool storage pool = pools[marketId];
        if (pool.initialized) revert PoolAlreadyInitialized();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        if (status != MarketFactory.MarketStatus.Open) revert MarketNotOpen();

        // Pull USDC from the initializer into the vault
        vault.depositFor(msg.sender, initialLiquidity);

        // Set equal reserves → 50/50 starting price
        pool.yesReserve = initialLiquidity;
        pool.noReserve = initialLiquidity;
        pool.initialized = true;

        emit PoolInitialized(marketId, initialLiquidity);
    }

    // ─── Trading ────────────────────────────────────────────────────────

    /// @notice Buy outcome tokens with USDC via CPMM.
    /// @param marketId      Market to trade in.
    /// @param outcome       0 = Yes, 1 = No.
    /// @param amount        USDC amount (6 decimals). Sender must have approved vault.
    /// @param minSharesOut  Minimum tokens to receive (slippage protection).
    function buyOutcome(
        uint256 marketId,
        uint8 outcome,
        uint256 amount,
        uint256 minSharesOut
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (outcome > 1) revert InvalidOutcome();

        Pool storage pool = pools[marketId];
        if (!pool.initialized) revert PoolNotInitialized();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        if (status != MarketFactory.MarketStatus.Open) revert MarketNotOpen();

        // Take fee from input (rounds UP — protocol's favor)
        uint256 fee = (amount * feeBps + BPS - 1) / BPS;
        uint256 netAmount = amount - fee;
        collectedFees[marketId] += fee;

        // Pull USDC into vault
        vault.depositFor(msg.sender, amount);

        // Track volume
        totalVolume[marketId] += amount;

        // CPMM: mint netAmount of BOTH tokens, add opposite to pool, take target out
        uint256 sharesOut;
        if (outcome == 0) {
            // Buying YES: NO tokens enter pool, YES tokens leave
            sharesOut = (pool.yesReserve * netAmount) / (pool.noReserve + netAmount);
            pool.noReserve += netAmount;
            pool.yesReserve -= sharesOut;
            yesSharesOf[marketId][msg.sender] += sharesOut;
        } else {
            // Buying NO: YES tokens enter pool, NO tokens leave
            sharesOut = (pool.noReserve * netAmount) / (pool.yesReserve + netAmount);
            pool.yesReserve += netAmount;
            pool.noReserve -= sharesOut;
            noSharesOf[marketId][msg.sender] += sharesOut;
        }

        if (sharesOut < minSharesOut) revert SlippageExceeded();

        emit OutcomeBought(marketId, msg.sender, outcome, amount, sharesOut);
    }

    /// @notice Sell outcome tokens for USDC via CPMM.
    /// @param marketId     Market to trade in.
    /// @param outcome      0 = Yes, 1 = No.
    /// @param shares       Number of tokens to sell.
    /// @param minUsdcOut   Minimum USDC to receive (slippage protection).
    function sellOutcome(
        uint256 marketId,
        uint8 outcome,
        uint256 shares,
        uint256 minUsdcOut
    ) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        if (outcome > 1) revert InvalidOutcome();

        Pool storage pool = pools[marketId];
        if (!pool.initialized) revert PoolNotInitialized();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        if (status != MarketFactory.MarketStatus.Open) revert MarketNotOpen();

        // Verify user has enough shares
        if (outcome == 0) {
            if (yesSharesOf[marketId][msg.sender] < shares) revert InsufficientShares();
        } else {
            if (noSharesOf[marketId][msg.sender] < shares) revert InsufficientShares();
        }

        // CPMM reverse: add tokens to pool, take opposite out
        uint256 grossUsdcOut;
        if (outcome == 0) {
            // Selling YES: YES enters pool, NO comes out
            grossUsdcOut = (pool.noReserve * shares) / (pool.yesReserve + shares);
            pool.yesReserve += shares;
            pool.noReserve -= grossUsdcOut;
            yesSharesOf[marketId][msg.sender] -= shares;
        } else {
            // Selling NO: NO enters pool, YES comes out
            grossUsdcOut = (pool.yesReserve * shares) / (pool.noReserve + shares);
            pool.noReserve += shares;
            pool.yesReserve -= grossUsdcOut;
            noSharesOf[marketId][msg.sender] -= shares;
        }

        // Take fee from output (rounds UP — protocol's favor)
        uint256 fee = (grossUsdcOut * feeBps + BPS - 1) / BPS;
        uint256 netUsdcOut = grossUsdcOut - fee;
        collectedFees[marketId] += fee;

        // Track volume
        totalVolume[marketId] += grossUsdcOut;

        if (netUsdcOut < minUsdcOut) revert SlippageExceeded();

        vault.withdrawTo(msg.sender, netUsdcOut);

        emit OutcomeSold(marketId, msg.sender, outcome, shares, netUsdcOut);
    }

    // ─── Claiming ───────────────────────────────────────────────────────

    /// @notice Claim winnings after resolution + settlement delay.
    ///         Each winning token = 1 USDC. Cancelled markets refund at 50/50.
    function claimWinnings(uint256 marketId) external nonReentrant {
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        uint256 payout;

        if (status == MarketFactory.MarketStatus.Resolved) {
            uint256 resolvedAt = factory.getResolvedAt(marketId);
            if (block.timestamp < resolvedAt + settlementDelay) revert MarketNotSettled();

            uint8 winningOutcome = factory.getResolvedOutcome(marketId);
            uint256 winnerShares = winningOutcome == 0
                ? yesSharesOf[marketId][msg.sender]
                : noSharesOf[marketId][msg.sender];

            if (winnerShares == 0) revert NothingToClaim();

            // Each winning outcome token = 1 USDC
            payout = winnerShares;
        } else if (status == MarketFactory.MarketStatus.Cancelled) {
            // Cancelled → refund all tokens at 50/50 value
            uint256 yShares = yesSharesOf[marketId][msg.sender];
            uint256 nShares = noSharesOf[marketId][msg.sender];
            if (yShares == 0 && nShares == 0) revert NothingToClaim();
            payout = (yShares + nShares) / 2;
        } else {
            revert MarketNotClaimable();
        }

        if (payout == 0) revert NothingToClaim();

        claimed[marketId][msg.sender] = true;
        vault.withdrawTo(msg.sender, payout);

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─── View helpers ───────────────────────────────────────────────────

    /// @notice Get price of an outcome in basis points (0–10000 = 0%–100%).
    function getPrice(
        uint256 marketId,
        uint8 outcome
    ) external view returns (uint256) {
        Pool storage pool = pools[marketId];
        if (!pool.initialized) return 5000; // Default 50%
        uint256 total = pool.yesReserve + pool.noReserve;
        if (total == 0) return 5000;
        if (outcome == 0) {
            return (pool.noReserve * BPS) / total;
        } else {
            return (pool.yesReserve * BPS) / total;
        }
    }

    /// @notice Get AMM reserves for a market.
    function getReserves(
        uint256 marketId
    ) external view returns (uint256 yesReserve, uint256 noReserve) {
        Pool storage pool = pools[marketId];
        return (pool.yesReserve, pool.noReserve);
    }

    /// @notice Get user's share balance for an outcome.
    function getUserShares(
        uint256 marketId,
        address user,
        uint8 outcome
    ) external view returns (uint256) {
        if (outcome == 0) return yesSharesOf[marketId][user];
        return noSharesOf[marketId][user];
    }

    /// @notice Check if pool is initialized for a market.
    function isPoolInitialized(
        uint256 marketId
    ) external view returns (bool) {
        return pools[marketId].initialized;
    }
}
