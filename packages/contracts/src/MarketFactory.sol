// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MarketFactory
/// @notice Creates and stores prediction-market structs. Owner creates markets;
///         a designated resolver contract may change market status.
contract MarketFactory is Ownable {
    enum MarketStatus {
        Open,
        Locked,
        Resolved,
        Cancelled
    }

    struct MarketData {
        string question;
        string[2] outcomes;
        uint256 resolutionTimestamp;
        MarketStatus status;
        uint8 resolvedOutcome;
        uint256 resolvedAt;
        uint256 createdAt;
    }

    /// @notice Auto-incrementing market counter (next ID to assign).
    uint256 public nextMarketId;

    /// @notice Address of the OracleResolver contract allowed to mutate market status.
    address public resolver;

    mapping(uint256 => MarketData) internal _markets;

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string[2] outcomes,
        uint256 resolutionTimestamp
    );
    event ResolverSet(address indexed resolver);

    error InvalidResolutionTimestamp();
    error MarketNotFound();
    error NotResolver();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    constructor(address _owner) Ownable(_owner) {}

    // ─── Owner functions ────────────────────────────────────────────────

    /// @notice Create a new binary prediction market.
    function createMarket(
        string calldata question,
        string[2] calldata outcomes,
        uint256 resolutionTimestamp
    ) external onlyOwner returns (uint256 marketId) {
        if (resolutionTimestamp <= block.timestamp) revert InvalidResolutionTimestamp();

        marketId = nextMarketId++;

        MarketData storage m = _markets[marketId];
        m.question = question;
        m.outcomes[0] = outcomes[0];
        m.outcomes[1] = outcomes[1];
        m.resolutionTimestamp = resolutionTimestamp;
        m.status = MarketStatus.Open;
        m.createdAt = block.timestamp;

        emit MarketCreated(marketId, question, outcomes, resolutionTimestamp);
    }

    /// @notice Set the resolver contract address (e.g. OracleResolver).
    function setResolver(address _resolver) external onlyOwner {
        resolver = _resolver;
        emit ResolverSet(_resolver);
    }

    // ─── Resolver-only state mutations ──────────────────────────────────

    error InvalidStatusTransition(MarketStatus current, MarketStatus attempted);

    function resolveMarket(uint256 marketId, uint8 outcome) external onlyResolver {
        _requireExists(marketId);
        MarketData storage m = _markets[marketId];
        // Can only resolve an Open or Locked market
        if (m.status != MarketStatus.Open && m.status != MarketStatus.Locked) {
            revert InvalidStatusTransition(m.status, MarketStatus.Resolved);
        }
        m.status = MarketStatus.Resolved;
        m.resolvedOutcome = outcome;
        m.resolvedAt = block.timestamp;
    }

    function pauseMarket(uint256 marketId) external onlyResolver {
        _requireExists(marketId);
        MarketData storage m = _markets[marketId];
        if (m.status != MarketStatus.Open) {
            revert InvalidStatusTransition(m.status, MarketStatus.Locked);
        }
        m.status = MarketStatus.Locked;
    }

    function unpauseMarket(uint256 marketId) external onlyResolver {
        _requireExists(marketId);
        MarketData storage m = _markets[marketId];
        if (m.status != MarketStatus.Locked) {
            revert InvalidStatusTransition(m.status, MarketStatus.Open);
        }
        m.status = MarketStatus.Open;
    }

    function cancelMarket(uint256 marketId) external onlyResolver {
        _requireExists(marketId);
        MarketData storage m = _markets[marketId];
        // Can cancel Open or Locked markets only; not already Resolved or Cancelled
        if (m.status == MarketStatus.Resolved || m.status == MarketStatus.Cancelled) {
            revert InvalidStatusTransition(m.status, MarketStatus.Cancelled);
        }
        m.status = MarketStatus.Cancelled;
    }

    // ─── View helpers ───────────────────────────────────────────────────

    function getMarket(uint256 marketId) external view returns (MarketData memory) {
        _requireExists(marketId);
        return _markets[marketId];
    }

    function getMarketStatus(uint256 marketId) external view returns (MarketStatus) {
        _requireExists(marketId);
        return _markets[marketId].status;
    }

    function getResolvedOutcome(uint256 marketId) external view returns (uint8) {
        _requireExists(marketId);
        return _markets[marketId].resolvedOutcome;
    }

    function getResolvedAt(uint256 marketId) external view returns (uint256) {
        _requireExists(marketId);
        return _markets[marketId].resolvedAt;
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _requireExists(uint256 marketId) internal view {
        if (marketId >= nextMarketId) revert MarketNotFound();
    }
}
