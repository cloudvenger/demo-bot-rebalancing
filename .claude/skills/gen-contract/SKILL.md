---
description: Generate a Solidity smart contract following project conventions
argument-hint: "[ContractName]"
---

Generate a Solidity smart contract following project conventions.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Identify the contract from the arguments or ask the user:
   - What is the contract's purpose? (e.g., ERC20 token, ERC721 NFT, staking logic, governance, custom logic)
   - Does it need upgradeability? (proxy pattern or immutable)
   - What access control model? (Ownable, AccessControl, none)
3. Read `contracts/CLAUDE.md` for stack, conventions, and security rules
4. Read `SPEC.md` to understand the business logic and acceptance criteria for this contract
5. Read `PLAN.md` to verify this contract is in the architecture — flag any discrepancy before proceeding
6. Generate the contract file:
   - Solidity version pragma from `contracts/CLAUDE.md`
   - NatSpec (`@notice`, `@param`, `@return`) on all public/external functions
   - Custom errors instead of `require` strings
   - Events for every state change
   - ReentrancyGuard on functions sending ETH or calling external contracts
   - Access control pattern from `contracts/CLAUDE.md`
   - Storage layout comment at the top if the contract has non-trivial storage
   - Place in `contracts/` directory following project conventions
7. Generate a test file alongside the contract:
   - Unit tests for every function (happy path + all revert conditions)
   - At least one fuzz test for functions with user-supplied numeric inputs
   - One fork/integration test covering a full user flow
8. Run `/check` — fix any compilation errors or test failures before proceeding
9. Report: contract file path, test file path, ABI summary (functions + events), any security decisions made explicit
