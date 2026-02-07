// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CollateralVault
/// @notice Custodies USDC deposits. Only authorized contracts (e.g. ParimutuelEngine) may move funds.
contract CollateralVault is Ownable {
    IERC20 public immutable usdc;

    mapping(address => bool) public authorized;

    event AuthorizedSet(address indexed account, bool status);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotAuthorized();
    error ZeroAmount();
    error TransferFailed();

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address _usdc, address _owner) Ownable(_owner) {
        usdc = IERC20(_usdc);
    }

    /// @notice Owner grants or revokes authorization for a contract to move funds.
    function setAuthorized(address account, bool status) external onlyOwner {
        authorized[account] = status;
        emit AuthorizedSet(account, status);
    }

    /// @notice Pull USDC from `from` into this vault. Caller must be authorized.
    /// @dev `from` must have approved this vault for at least `amount`.
    function depositFor(address from, uint256 amount) external onlyAuthorized {
        if (amount == 0) revert ZeroAmount();
        bool ok = usdc.transferFrom(from, address(this), amount);
        if (!ok) revert TransferFailed();
        emit Deposited(from, amount);
    }

    /// @notice Send USDC from this vault to `to`. Caller must be authorized.
    function withdrawTo(address to, uint256 amount) external onlyAuthorized {
        if (amount == 0) revert ZeroAmount();
        bool ok = usdc.transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }
}
