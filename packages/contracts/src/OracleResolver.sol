// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MarketFactory} from "./MarketFactory.sol";

/// @title OracleResolver
/// @notice Owner-only oracle that resolves, pauses, unpauses, or cancels markets
///         via the MarketFactory.
contract OracleResolver is Ownable {
    MarketFactory public immutable factory;

    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome);
    event MarketPaused(uint256 indexed marketId);
    event MarketUnpaused(uint256 indexed marketId);
    event MarketCancelled(uint256 indexed marketId);

    error InvalidOutcome();
    error ResolutionTooEarly(uint256 resolutionTimestamp, uint256 currentTime);

    constructor(address _factory, address _owner) Ownable(_owner) {
        factory = MarketFactory(_factory);
    }

    /// @notice Resolve a market with the winning outcome (0=Yes/Home, 1=No/Away, 2=Draw).
    /// @dev Enforces that the market's resolutionTimestamp has passed.
    function resolve(uint256 marketId, uint8 winningOutcome) external onlyOwner {
        if (winningOutcome > 2) revert InvalidOutcome();
        MarketFactory.MarketData memory m = factory.getMarket(marketId);
        if (block.timestamp < m.resolutionTimestamp) {
            revert ResolutionTooEarly(m.resolutionTimestamp, block.timestamp);
        }
        factory.resolveMarket(marketId, winningOutcome);
        emit MarketResolved(marketId, winningOutcome);
    }

    /// @notice Temporarily lock a market (no trading).
    function pause(uint256 marketId) external onlyOwner {
        factory.pauseMarket(marketId);
        emit MarketPaused(marketId);
    }

    /// @notice Re-open a previously paused market.
    function unpause(uint256 marketId) external onlyOwner {
        factory.unpauseMarket(marketId);
        emit MarketUnpaused(marketId);
    }

    /// @notice Permanently cancel a market; users may reclaim deposits.
    function cancel(uint256 marketId) external onlyOwner {
        factory.cancelMarket(marketId);
        emit MarketCancelled(marketId);
    }
}
