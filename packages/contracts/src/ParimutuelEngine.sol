// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MarketFactory} from "./MarketFactory.sol";
import {CollateralVault} from "./CollateralVault.sol";

/// @title ParimutuelEngine
/// @notice Parimutuel (pool-based) trading for binary prediction markets.
///         Users deposit USDC to buy outcome shares 1:1. On resolution, winners
///         split the total pool minus a protocol fee.
contract ParimutuelEngine is ReentrancyGuard {
    // ─── Constants ──────────────────────────────────────────────────────

    uint256 public immutable feeBps;        // e.g. 200 = 2 %
    uint256 public immutable settlementDelay; // seconds after resolution before claims open

    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ─── External references ────────────────────────────────────────────

    MarketFactory public immutable factory;
    CollateralVault public immutable vault;

    // ─── Storage ────────────────────────────────────────────────────────

    /// marketId => outcome (0 or 1) => total shares
    mapping(uint256 => mapping(uint8 => uint256)) public totalSharesByOutcome;

    /// marketId => total USDC deposited into the pool
    mapping(uint256 => uint256) public totalPool;

    /// marketId => user => outcome => shares
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public userShares;

    /// marketId => user => true if already claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    // ─── Events ─────────────────────────────────────────────────────────

    event SharesPurchased(
        uint256 indexed marketId,
        address indexed buyer,
        uint8 outcome,
        uint256 amount
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
    error MarketNotSettled();
    error AlreadyClaimed();
    error NothingToClaim();
    error MarketNotClaimable();

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

    // ─── Trading ────────────────────────────────────────────────────────

    /// @notice Buy shares for a binary outcome. Shares are minted 1:1 with USDC.
    /// @param marketId  Market to trade in.
    /// @param outcome   0 or 1.
    /// @param amount    USDC amount (6-decimal). msg.sender must have approved the vault.
    function buyShares(uint256 marketId, uint8 outcome, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (outcome > 1) revert InvalidOutcome();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        if (status != MarketFactory.MarketStatus.Open) revert MarketNotOpen();

        // Pull USDC from buyer into the vault.
        vault.depositFor(msg.sender, amount);

        // Mint shares 1:1 with USDC deposited.
        totalSharesByOutcome[marketId][outcome] += amount;
        totalPool[marketId] += amount;
        userShares[marketId][msg.sender][outcome] += amount;

        emit SharesPurchased(marketId, msg.sender, outcome, amount);
    }

    // ─── Claiming ───────────────────────────────────────────────────────

    /// @notice Claim winnings after resolution + settlement delay, or reclaim
    ///         deposits if the market was cancelled / had zero winning shares.
    function claimWinnings(uint256 marketId) external nonReentrant {
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        uint256 payout;

        if (status == MarketFactory.MarketStatus.Resolved) {
            // Enforce settlement delay.
            uint256 resolvedAt = factory.getResolvedAt(marketId);
            if (block.timestamp < resolvedAt + settlementDelay) revert MarketNotSettled();

            uint8 winningOutcome = factory.getResolvedOutcome(marketId);
            uint256 winningPool = totalSharesByOutcome[marketId][winningOutcome];

            if (winningPool == 0) {
                // Edge case: nobody bet on the winning side → full refund, no fee.
                payout = _userTotalDeposit(marketId, msg.sender);
            } else {
                // Normal payout from the pool minus fee.
                uint256 winnerShares = userShares[marketId][msg.sender][winningOutcome];
                if (winnerShares == 0) revert NothingToClaim();

                uint256 pool = totalPool[marketId];

                // fee = ceil(pool * feeBps / BPS_DENOMINATOR)  →  rounds UP (protocol's favor)
                uint256 fee = (pool * feeBps + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;
                uint256 netPool = pool - fee;

                // payout = floor(winnerShares * netPool / winningPool)  →  rounds DOWN
                payout = (winnerShares * netPool) / winningPool;
            }
        } else if (status == MarketFactory.MarketStatus.Cancelled) {
            // Cancelled → full refund of deposits, no fee.
            payout = _userTotalDeposit(marketId, msg.sender);
        } else {
            revert MarketNotClaimable();
        }

        if (payout == 0) revert NothingToClaim();

        claimed[marketId][msg.sender] = true;
        vault.withdrawTo(msg.sender, payout);

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─── View helpers ───────────────────────────────────────────────────

    function getUserShares(
        uint256 marketId,
        address user,
        uint8 outcome
    ) external view returns (uint256) {
        return userShares[marketId][user][outcome];
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /// @dev Sum of shares across both outcomes = user's total USDC deposited.
    function _userTotalDeposit(uint256 marketId, address user) internal view returns (uint256) {
        return userShares[marketId][user][0] + userShares[marketId][user][1];
    }
}
