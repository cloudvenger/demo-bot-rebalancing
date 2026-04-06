# Contracts Agent Context

Inherits all rules from root [CLAUDE.md](../CLAUDE.md). Rules below are specific to the smart contract layer.

---

## Responsibilities
- Smart contract logic and on-chain storage
- Events, errors, and ABI design
- Access control and role management
- Upgradability strategy (if any)
- Deployment scripts and network configuration
- Contract verification on block explorers

---

## Stack (fill in after scaffolding)
- **Chain/network**: TBD (Ethereum / Polygon / Base / Arbitrum / etc.)
- **Framework**: TBD (Hardhat / Foundry)
- **Solidity version**: TBD (e.g., ^0.8.24)
- **Libraries**: TBD (OpenZeppelin / Solmate / etc.)
- **Testing approach**: TBD (Hardhat + ethers.js / Foundry forge)

---

## Architecture Pattern
- **Upgradeability**: TBD (Immutable / UUPS proxy / Transparent proxy / Diamond EIP-2535)
  - **Immutable**: no upgrade mechanism — simplest, most secure, use when contract logic is final
  - **UUPS proxy**: upgrade logic in the implementation contract — recommended for most upgradeable contracts
  - **Transparent proxy**: OpenZeppelin default — admin calls go to proxy, user calls go to impl
  - **Diamond (EIP-2535)**: modular upgrades across multiple facets — only for large, complex systems
- **Factory pattern**: TBD (Yes / No)
  - If Yes: a `Factory` contract deploys and tracks new instances; use when many identical contracts are deployed per user or entity
- **Registry pattern**: TBD (Yes / No)
  - If Yes: a `Registry` contract maps names/roles to deployed addresses; use instead of hardcoding addresses in contracts
- **Payment disbursement**: Pull payment — users call `withdraw()` themselves; never push ETH to arbitrary addresses

> Filled in during Phase 3 by `/plan` or at setup by `./setup.sh`.

---

## SOLID Principles (adapted for Solidity)

Solidity has no interfaces in the OOP sense, but SOLID still applies — especially S, I, and D, which directly affect security and upgradeability.

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | Each contract has one clear purpose. Avoid "god contracts" that combine token logic, staking logic, and governance in one file. Split by concern — the factory deploys, the registry tracks, the vault holds funds. |
| **O** — Open/Closed | Deployed contracts cannot be modified. Design for extension via proxy patterns (UUPS / Diamond) or by composing with new contracts rather than redeploying. The core logic should not need to change to add a new feature. |
| **L** — Liskov Substitution | Contracts implementing the same interface (e.g., `IERC20`) must be fully substitutable. Any contract that receives an `IERC20` address must work correctly with any compliant token — not just the one you tested with. |
| **I** — Interface Segregation | Keep Solidity interfaces minimal. Define one interface per consumer role: a contract that only reads balances should not depend on a full `IERC20` — define a slim `IBalanceOf` instead. Small interfaces reduce coupling and attack surface. |
| **D** — Dependency Inversion | Contracts depend on **interfaces**, not concrete addresses. Cross-contract dependencies are passed via constructor or registry — never hardcoded. This is also a security rule: hardcoded addresses cannot be updated if a dependency is compromised. |

**Practical checklist before any PR:**
- [ ] Does this contract do exactly one thing? If it does two, split it.
- [ ] Are all cross-contract dependencies injected via constructor or registry?
- [ ] Does this contract implement only the interface methods it actually needs?
- [ ] Could you replace a dependency contract without changing this contract's code?

---

## Contract Conventions
- NatSpec (`@notice`, `@param`, `@return`) on every public and external function
- Custom errors instead of `require` strings — more gas-efficient and machine-readable:
  ```solidity
  error Unauthorized(address caller);
  error InsufficientBalance(uint256 available, uint256 required);
  ```
- Emit an event for every state change — events are the audit log of the contract
- Document the storage layout at the top of each contract (critical for upgradeable contracts)
- Function ordering: `external` → `public` → `internal` → `private`
- Constants and immutables in `UPPER_SNAKE_CASE`
- No magic numbers — use named constants

---

## Security Rules
- **Checks-Effects-Interactions**: validate inputs, update state, then call external contracts — in that order
- `ReentrancyGuard` on any function that sends ETH or calls an untrusted external contract
- Access control via OpenZeppelin `Ownable` or `AccessControl` — never raw `msg.sender == owner` checks outside a modifier
- Never use `tx.origin` for authentication — always `msg.sender`
- No hardcoded addresses in contract code — pass them as constructor arguments or use a registry
- Integer arithmetic: Solidity ≥0.8 has built-in overflow checks — do not use SafeMath
- Pull over push for ETH payments — never push ETH to arbitrary addresses in a loop

---

## Testing
- Unit test every public/external function: happy path + all revert conditions
- Fuzz tests for any function involving arithmetic or user-supplied amounts (Foundry `forge test` or Hardhat property tests)
- Fork test: one integration test running against a mainnet/testnet fork covering a full user flow
- 100% line coverage for core contract logic — no uncovered revert branches
- Test file naming: `ContractName.t.sol` (Foundry) or `ContractName.test.ts` (Hardhat)

---

## Deployment
- All deployments via scripts — never deploy manually from a REPL
- Deployment scripts are idempotent: check if already deployed before deploying
- Verify contracts on the block explorer after every deployment
- Store deployed addresses in a `deployments/<network>.json` file — never hardcode them
- Never store private keys in code or `.env` files committed to the repo

---

## Gas Conventions
- Pack struct fields to minimize storage slots (smaller types together)
- Prefer `calldata` over `memory` for read-only function parameters
- Avoid unbounded loops — any loop over user-controlled data is a DoS vector
- Run the gas reporter after every significant change and review regressions
