// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestRupee — test money for the hackathon. Not real money.
/// @notice 2 decimals so 1 unit = 1 paisa. faucet() gives ₹5,000 once per day.
contract TestRupee is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 500_000; // ₹5,000.00
    uint256 public constant COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Test Rupee", "tINR") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + COOLDOWN) revert FaucetCooldown(last + COOLDOWN);
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
