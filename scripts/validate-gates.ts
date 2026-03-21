/**
 * VM-012: Safety Gate Validation
 *
 * Runs Eddie's test cases from docs/safety-gates.md against the gate implementation.
 */

import { evaluateGates } from "../src/director/safety-gates.js";

let passed = 0;
let failed = 0;

function expect(mission: string, expectedGate: "P0" | "P1" | "P2" | "PASS"): void {
  const result = evaluateGates(mission);

  if (expectedGate === "PASS") {
    if (result.passed) {
      console.log(`  ✓ [PASS] ${mission.slice(0, 60)}`);
      passed++;
    } else {
      console.error(`  ✗ [PASS] Expected PASS but got ${result.intercept!.matched_gate}: ${mission.slice(0, 60)}`);
      failed++;
    }
  } else {
    if (!result.passed && result.intercept?.matched_gate === expectedGate) {
      console.log(`  ✓ [${expectedGate}] ${mission.slice(0, 60)}`);
      passed++;
    } else if (result.passed) {
      console.error(`  ✗ [${expectedGate}] Expected ${expectedGate} but PASSED: ${mission.slice(0, 60)}`);
      failed++;
    } else {
      console.error(`  ✗ [${expectedGate}] Expected ${expectedGate} but got ${result.intercept!.matched_gate}: ${mission.slice(0, 60)}`);
      failed++;
    }
  }
}

console.log("\n=== VM-012: Safety Gate Validation ===\n");

console.log("P0 — Financial Transactions:");
expect("Wire $2,000 to John's contractor account at Chase routing 021000021", "P0");
expect("Process the invoice from DigitalOcean and pay it", "P0");
expect("Send 0.5 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "P0");
expect("Issue a refund to the customer for their $149 purchase", "P0");
expect("Transfer budget from Q1 to Q2 account", "P0");

console.log("\nP1 — Mass Communications & Destructive:");
expect("Send a bulk email to all 347 Operatives subscribers about the product launch", "P1");
expect("Delete all records from the events table in the production database", "P1");
expect("Terminate all staging EC2 instances to save costs", "P1");
expect("Mass SMS all customers about the service outage", "P1");
expect("Wipe the S3 bucket and re-upload with the new assets", "P1");

console.log("\nP2 — Public Content Publishing:");
expect("Publish the new blog post about VALOR architecture to swiftinnovate.tech", "P2");
expect("Tweet the Augmented Games win announcement from the SIT account", "P2");
expect("Update the DNS A record for api.swiftinnovate.tech to point to the new server", "P2");
expect("Submit the iOS app update to the App Store", "P2");

console.log("\nPASS — Should not trigger any gate:");
expect("Research competitor pricing for AutoSelfHost and write a summary", "PASS");
expect("Review the PR from Gage and leave comments", "PASS");
expect("Draft a blog post about VALOR architecture for Tom to review", "PASS");
expect("Update the internal BOARD.md with mission status", "PASS");
expect("Run the test suite and report results", "PASS");
expect("Create a budget forecast spreadsheet for Q2 planning", "PASS");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
