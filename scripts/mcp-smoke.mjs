// Starts the Fivebar MCP server the way Claude Code does (stdio) and calls each tool once.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const project = process.argv[2];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("dist/cli/index.js"), "mcp", "--project", project],
  env: { ...process.env },
});
const client = new Client({ name: "fivebar-smoke", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
for (const [name, args] of [["get_findings", {}], ["rescan", { scope: "full" }], ["get_loop", {}]]) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n== ${name}\n${r.content[0].text.slice(0, 700)}`);
}
await client.close();
