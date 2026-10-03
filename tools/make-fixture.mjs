#!/usr/bin/env node
// Emits public/fixtures/add.wasm: a hand-assembled WebAssembly module exporting
// add(i32, i32) -> i32. Zero dependencies. Deterministic: the same source always
// produces the same bytes, so the checked-in fixture is reproducible from this file.
//
// The module is assembled from the binary format directly (no wat2wasm, no
// toolchain) because the pilot container has no crates.io/npm access. Section
// layout follows the WebAssembly core specification, binary format:
//   magic "\0asm", version 1, then Type(1), Function(3), Export(7), Code(10).
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "fixtures", "add.wasm");

/** Unsigned LEB128. Sizes and indices in the binary format are all u32 LEB128. */
function uleb(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`uleb: ${value}`);
  const out = [];
  let n = value;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

/** A section is its id, then the LEB128 byte length of its payload, then the payload. */
function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

/** A vector is its LEB128 element count followed by the encoded elements. */
function vec(elements) {
  return [...uleb(elements.length), ...elements.flat()];
}

const utf8 = (text) => [...Buffer.from(text, "utf8")];

const I32 = 0x7f;
const FUNC_TYPE = 0x60;
const EXPORT_FUNC = 0x00;
const LOCAL_GET = 0x20;
const I32_ADD = 0x6a;
const END = 0x0b;

// (type (func (param i32 i32) (result i32)))
const typeSection = section(1, vec([[FUNC_TYPE, ...vec([[I32], [I32]]), ...vec([[I32]])]]));
// (func $add (type 0))  -- one function, using type index 0
const functionSection = section(3, vec([[0x00]]));
// (export "add" (func 0))
const exportSection = section(7, vec([[...vec(utf8("add").map((b) => [b])), EXPORT_FUNC, 0x00]]));
// body: no locals; local.get 0; local.get 1; i32.add; end
const body = [...vec([]), LOCAL_GET, 0x00, LOCAL_GET, 0x01, I32_ADD, END];
const codeSection = section(10, vec([[...uleb(body.length), ...body]]));

const bytes = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, // magic: "\0asm"
  0x01, 0x00, 0x00, 0x00, // version: 1
  ...typeSection,
  ...functionSection,
  ...exportSection,
  ...codeSection,
]);

// Refuse to emit a module this process cannot itself validate and run.
const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
const add = instance.exports.add;
if (typeof add !== "function") throw new Error("fixture does not export a callable add");
if (add(2, 3) !== 5) throw new Error(`fixture add(2,3) returned ${add(2, 3)}, expected 5`);
if (add(-1, 1) !== 0) throw new Error("fixture add(-1,1) did not return 0");

const sha256 = createHash("sha256").update(bytes).digest("hex");

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, bytes);

process.stdout.write(
  `${JSON.stringify({ path: "public/fixtures/add.wasm", bytes: bytes.length, sha256 }, null, 2)}\n`,
);
