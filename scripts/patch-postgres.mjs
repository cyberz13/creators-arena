/**
 * postinstall: guard a process-crashing bug in postgres.js 3.4.x.
 *
 * When the server (or a pooler) drops a connection in the middle of a
 * transaction, postgres.js nulls the socket in `closed()` and then its own
 * rollback path schedules `nextWrite()` on that dead connection. The write
 * runs from a setImmediate — outside any promise — so the resulting
 * `TypeError: Cannot read properties of null (reading 'write')` is an
 * uncaught exception that takes the whole Node process down (reproduced
 * with `SELECT pg_terminate_backend(pg_backend_pid())` inside a transaction,
 * see scripts/pg-concurrency-test.mjs scenario H).
 *
 * The patch makes `nextWrite()` drop the buffered bytes when there is no
 * socket instead of dereferencing null. It is idempotent, patches every
 * build the package ships (src / cjs / cf), and FAILS LOUDLY if the expected
 * line is missing — so a future upgrade of `postgres` is reviewed, not
 * silently left unpatched. Nothing else in the library is touched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["src/connection.js", "cjs/src/connection.js", "cf/src/connection.js"].map((f) =>
  path.join(root, "node_modules", "postgres", f)
);

const ORIGINAL = "    const x = socket.write(chunk, fn)\n";
const PATCHED =
  "    if (!socket) { // patched by scripts/patch-postgres.mjs: connection already closed — drop the buffer instead of crashing the process\n" +
  "      nextWriteTimer !== null && clearImmediate(nextWriteTimer)\n" +
  "      chunk = nextWriteTimer = null\n" +
  "      return false\n" +
  "    }\n" +
  ORIGINAL;

let patched = 0;
let already = 0;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`patch-postgres: ${path.relative(root, file)} not found — postgres.js layout changed; review the patch`);
    process.exit(1);
  }
  const s = fs.readFileSync(file, "utf8");
  if (s.includes(PATCHED)) {
    already += 1;
    continue;
  }
  if (!s.includes(ORIGINAL)) {
    console.error(`patch-postgres: expected line not found in ${path.relative(root, file)} — postgres.js changed; review the patch`);
    process.exit(1);
  }
  fs.writeFileSync(file, s.replace(ORIGINAL, PATCHED));
  patched += 1;
}
console.log(`patch-postgres: ${patched} file(s) patched, ${already} already patched`);
