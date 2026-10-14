// stdout is the MCP wire. Every diagnostic line goes to stderr, no exceptions.
export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}
