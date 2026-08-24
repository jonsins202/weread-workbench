// CLI 入口：node server/cli.js [--dry-run] [--book <bookId|书名片段>]
import { syncAll } from "./sync.js";

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--book") opts.book = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
}

const opts = parseArgs(process.argv);
if (opts.help) {
  console.log(`用法: node server/cli.js [--dry-run] [--book <bookId|书名片段>]
  --dry-run   只打印计划，不写任何文件
  --book      只同步指定的一本书`);
  process.exit(0);
}

try {
  const report = await syncAll(opts);
  console.log(report.join("\n"));
  console.log(`\n共 ${report.length} 项`);
} catch (e) {
  console.error("同步失败:", e.message);
  process.exit(1);
}
