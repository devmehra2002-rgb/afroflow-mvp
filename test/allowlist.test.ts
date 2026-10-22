import { isAllowed, parseAllowList } from "../src/lib/allowlist";
let passed = 0, failed = 0;
const check = (c: boolean, l: string) => { if (c) passed++; else { failed++; console.error("FAIL:", l); } };

const a = parseAllowList("Dev@x.com, other@y.com ", "eakbari@mesaschool.co");
check(a.length === 3, "both lists are merged");
check(isAllowed("eakbari@mesaschool.co", a), "added person is allowed");
check(isAllowed("EAkbari@MesaSchool.co", a), "case does not matter");
check(isAllowed("dev@x.com", a) && isAllowed("other@y.com", a), "existing people stay allowed");
check(!isAllowed("stranger@z.com", a), "strangers are refused");
check(!isAllowed("eakbari@mesaschool.com", a), "lookalike domain is refused");
check(!isAllowed("xeakbari@mesaschool.co", a), "partial match is refused");
check(!isAllowed(null, a) && !isAllowed("", a) && !isAllowed(undefined, a), "missing email is refused");
check(parseAllowList(undefined, undefined).length === 0 && !isAllowed("a@b.c", []), "empty config allows nobody");
check(parseAllowList("a@b.c,a@b.c", "A@B.C").length === 1, "duplicates collapse");
check(parseAllowList(",, ,", "").length === 0, "blank entries ignored");
console.log(`allowlist tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
