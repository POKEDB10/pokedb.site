// scripts/bench/analyze-snapshot.js
// Parses a V8 .heapsnapshot JSON file and reports top retained types sorted by shallow size.

const fs = require('node:fs');

function analyzeSnapshot(snapshotPath, topN = 10) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }

  const raw = fs.readFileSync(snapshotPath, 'utf8');
  const data = JSON.parse(raw);
  const meta = data.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[0];
  const strings = data.strings;
  const nodes = data.nodes;
  const step = nodeFields.length;

  const byTypeOrConstructor = {};
  let totalShallowSize = 0;
  let totalNodeCount = 0;

  for (let i = 0; i < nodes.length; i += step) {
    const typeIndex = nodes[i];
    const nameIndex = nodes[i + 1];
    const selfSize = nodes[i + 3];
    const typeStr = nodeTypes[typeIndex] || 'unknown';
    const nameStr = strings[nameIndex] || 'unknown';

    const key = (typeStr === 'object' && nameStr) ? nameStr : typeStr;
    if (!byTypeOrConstructor[key]) {
      byTypeOrConstructor[key] = { count: 0, sizeBytes: 0, type: typeStr };
    }
    byTypeOrConstructor[key].count++;
    byTypeOrConstructor[key].sizeBytes += selfSize;
    totalShallowSize += selfSize;
    totalNodeCount++;
  }

  const sorted = Object.entries(byTypeOrConstructor)
    .sort((a, b) => b[1].sizeBytes - a[1].sizeBytes)
    .slice(0, topN)
    .map(([name, stat]) => ({
      name,
      type: stat.type,
      count: stat.count,
      sizeBytes: stat.sizeBytes,
      sizeKb: Number((stat.sizeBytes / 1024).toFixed(2)),
      sizeMb: Number((stat.sizeBytes / 1024 / 1024).toFixed(3)),
      percentTotal: Number(((stat.sizeBytes / (totalShallowSize || 1)) * 100).toFixed(2))
    }));

  return {
    snapshotPath,
    totalNodeCount,
    totalShallowSizeBytes: totalShallowSize,
    totalShallowSizeMb: Number((totalShallowSize / 1024 / 1024).toFixed(3)),
    topRetainedTypes: sorted
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/bench/analyze-snapshot.js <path-to-.heapsnapshot>');
    process.exit(1);
  }
  const result = analyzeSnapshot(file);
  console.log(`Snapshot: ${result.snapshotPath}`);
  console.log(`Total Nodes: ${result.totalNodeCount} | Total Shallow Size: ${result.totalShallowSizeMb} MB`);
  console.log('Top Retained Types:');
  for (const item of result.topRetainedTypes) {
    console.log(`  ${item.name.padEnd(25)} ${String(item.sizeKb).padStart(8)} kB (${String(item.count).padStart(7)} objects, ${item.percentTotal}%)`);
  }
}

module.exports = { analyzeSnapshot };
