import test from "node:test";

test.skip("skipped JavaScript seam", () => {});
test.todo("todo JavaScript seam");
test.only("only JavaScript seam", () => {});
test("callback-free JavaScript seam");

// test("comment-only JavaScript seam", () => {});
const stringOnlyDeclaration = 'test("string-only JavaScript seam", () => {})';
void stringOnlyDeclaration;

test("runnable JavaScript seam", () => {});
