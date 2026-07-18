/**
 * Keeper batch: settle every settleable demo market on-chain, in sequence, printing the tx signatures
 * and proof-receipt verdict. This is the "keeper loop" the demo runs at full-time — one command that
 * settles Outcomes (V1), the Combo (V3 multiproof), and the Batch (V3 derived) against the real oracle.
 */
import { buildCatalog } from "./catalog.js";
import { settleMarket, buildReceipt } from "./chain.js";
import { CONFIG } from "./config.js";

async function main() {
  const cat = await buildCatalog(CONFIG.demoFixtureId);
  const markets = [...cat.categories.outcomes, ...cat.categories.combos, ...cat.categories.batch].filter((m) => m.settleable);
  console.log(`\nKeeper: settling ${markets.length} markets on-chain (${CONFIG.rpcUrl})\n`);
  for (const m of markets) {
    const r = await settleMarket(m);
    const rec = await buildReceipt(m);
    console.log(`  ${m.generation.padEnd(2)} ${m.title.padEnd(28)} → ${r.winningSide.padEnd(3)} | resolve tx ${r.txids.resolve.slice(0, 12)}… | root match: ${rec.chain.onChain.match}`);
  }
  console.log("\nAll demo markets settled trustlessly. Receipts available via /api/receipt/:id\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
