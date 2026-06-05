// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MarketFactory} from "./MarketFactory.sol";
import {CollateralVault} from "./CollateralVault.sol";

/// @title ParimutuelEngine
/// @notice Parimutuel (pool-based) trading for prediction markets.
///         Supports binary (YES/NO) and 3-way (HOME/AWAY/DRAW) outcomes.
///
///         Fee accounting:
///           - Fee is taken upfront on each buy (rounds UP, protocol's favour).
///           - Net amount is minted as shares 1:1.
///           - totalPool tracks only net USDC (fees excluded).
///           - On resolution, winners split totalPool proportional to their shares.
///           - Accumulated fees per market can be withdrawn by the owner at any time.
///           - On cancellation, users are refunded their net deposit (fee is NOT refunded).
contract ParimutuelEngine is ReentrancyGuard, Ownable {

    // ─── Constants ──────────────────────────────────────────────────────

    uint256 public immutable feeBps;
    uint256 public immutable settlementDelay;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint8  private constant MAX_OUTCOME = 2; // 0 = Yes/Home, 1 = No/Away, 2 = Draw

    // ─── External references ────────────────────────────────────────────

    MarketFactory   public immutable factory;
    CollateralVault public immutable vault;

    // ─── Storage ────────────────────────────────────────────────────────

    /// marketId => outcome => total net shares in that outcome pool
    mapping(uint256 => mapping(uint8 => uint256)) public totalSharesByOutcome;

    /// marketId => total net USDC across all outcomes (fees already excluded)
    mapping(uint256 => uint256) public totalPool;

    /// marketId => user => outcome => net shares held
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public userShares;

    /// marketId => user => true if already claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// marketId => accumulated protocol fees (USDC raw, 6 decimals)
    mapping(uint256 => uint256) public accumulatedFees;

    /// marketId => true once fees have been withdrawn (prevents double-withdrawal)
    mapping(uint256 => bool) public feesWithdrawn;

    // ─── Events ─────────────────────────────────────────────────────────

    event SharesPurchased(
        uint256 indexed marketId,
        address indexed buyer,
        uint8   outcome,
        uint256 grossAmount,
        uint256 netShares
    );
    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed claimant,
        uint256 payout
    );
    event FeesWithdrawn(
        uint256 indexed marketId,
        address indexed to,
        uint256 amount
    );

    // ─── Errors ─────────────────────────────────────────────────────────

    error MarketNotOpen();
    error InvalidOutcome();
    error ZeroAmount();
    error MarketNotSettled();
    error AlreadyClaimed();
    error NothingToClaim();
    error MarketNotClaimable();
    error FeesAlreadyWithdrawn();
    error NoFeesAccumulated();

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(
        address _factory,
        address _vault,
        uint256 _feeBps,
        uint256 _settlementDelay,
        address _owner
    ) Ownable(_owner) {
        factory        = MarketFactory(_factory);
        vault          = CollateralVault(_vault);
        feeBps         = _feeBps;
        settlementDelay = _settlementDelay;
    }

    // ─── Trading ────────────────────────────────────────────────────────

    /// @notice Buy shares for an outcome. Fee taken upfront; net minted as shares.
    /// @param marketId  Market to trade in.
    /// @param outcome   0 = Yes/Home, 1 = No/Away, 2 = Draw.
    /// @param amount    Gross USDC (6-decimal). msg.sender must have approved the vault.
    function buyShares(
        uint256 marketId,
        uint8   outcome,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0)           revert ZeroAmount();
        if (outcome > MAX_OUTCOME) revert InvalidOutcome();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        if (status != MarketFactory.MarketStatus.Open) revert MarketNotOpen();

        vault.depositFor(msg.sender, amount);

        // Fee taken upfront (rounds UP — protocol's favour).
        uint256 fee       = (amount * feeBps + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;

        accumulatedFees[marketId]                          += fee;
        totalSharesByOutcome[marketId][outcome]            += netAmount;
        totalPool[marketId]                                += netAmount;
        userShares[marketId][msg.sender][outcome]          += netAmount;

        emit SharesPurchased(marketId, msg.sender, outcome, amount, netAmount);
    }

    // ─── Claiming ───────────────────────────────────────────────────────

    /// @notice Claim winnings after resolution + settlement delay, or reclaim
    ///         net deposits on cancellation or zero-winning-pool edge case.
    function claimWinnings(uint256 marketId) external nonReentrant {
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        MarketFactory.MarketStatus status = factory.getMarketStatus(marketId);
        uint256 payout;

        if (status == MarketFactory.MarketStatus.Resolved) {
            uint256 resolvedAt = factory.getResolvedAt(marketId);
            if (block.timestamp < resolvedAt + settlementDelay) revert MarketNotSettled();

            uint8   winningOutcome = factory.getResolvedOutcome(marketId);
            uint256 winningPool    = totalSharesByOutcome[marketId][winningOutcome];

            if (winningPool == 0) {
                // Edge case: nobody bet on the winning side → refund net deposits.
                payout = _userNetDeposit(marketId, msg.sender);
            } else {
                uint256 winnerShares = userShares[marketId][msg.sender][winningOutcome];
                if (winnerShares == 0) revert NothingToClaim();

                // totalPool is net of fees — no further deduction needed.
                // payout = floor(winnerShares * totalPool / winningPool)
                payout = (winnerShares * totalPool[marketId]) / winningPool;
            }
        } else if (status == MarketFactory.MarketStatus.Cancelled) {
            // Refund net deposit. Fee is non-refundable on cancellation.
            payout = _userNetDeposit(marketId, msg.sender);
        } else {
            revert MarketNotClaimable();
        }

        if (payout == 0) revert NothingToClaim();

        claimed[marketId][msg.sender] = true;
        vault.withdrawTo(msg.sender, payout);

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─── Protocol fee withdrawal ─────────────────────────────────────────

    /// @notice Withdraw accumulated protocol fees for a market to `to`.
    ///         Safe to call at any time after fees have accumulated.
    ///         Can only be called once per market.
    function withdrawFees(uint256 marketId, address to) external onlyOwner nonReentrant {
        if (feesWithdrawn[marketId]) revert FeesAlreadyWithdrawn();
        uint256 amount = accumulatedFees[marketId];
        if (amount == 0) revert NoFeesAccumulated();

        feesWithdrawn[marketId] = true;
        vault.withdrawTo(to, amount);

        emit FeesWithdrawn(marketId, to, amount);
    }

    // ─── View helpers ───────────────────────────────────────────────────

    function getUserShares(
        uint256 marketId,
        address user,
        uint8   outcome
    ) external view returns (uint256) {
        return userShares[marketId][user][outcome];
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /// @dev Sum of net shares across all three outcome slots.
    function _userNetDeposit(uint256 marketId, address user) internal view returns (uint256) {
        return
            userShares[marketId][user][0] +
            userShares[marketId][user][1] +
            userShares[marketId][user][2];
    }
}
