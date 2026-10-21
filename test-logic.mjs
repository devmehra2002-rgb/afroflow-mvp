// Lightweight logic tests for the three features added to afroflow.html.
//
// afroflow.html is a single static file with no module system and no
// existing test framework — its functions are defined inline in a <script>
// tag and reach into `document`/`localStorage` directly, so they can't be
// imported here. Rather than build a fake DOM to exercise the real file,
// these tests mirror the specific business rules those functions implement
// (container quantity formatting, inquiry/shipment date validation, and the
// document-upload -> task-complete -> workflow-update behavior including its
// idempotency and revert rules). If those rules change in afroflow.html,
// update the mirrored versions here too.
//
// Run with: node test-logic.mjs

let passed = 0, failed = 0;
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; }
  else { failed++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ---- Feature 1: container quantity ----
function formatQty(o) {
  if (o.containerType && o.containerCount) {
    const label = o.containerType === '40ft' ? '40 ft' : '20 ft';
    return `${o.containerCount} × ${label} container${o.containerCount > 1 ? 's' : ''}`;
  }
  return o.qty || '—';
}

assertEqual(formatQty({containerType:'40ft', containerCount:3}), '3 × 40 ft containers', 'formats plural 40ft');
assertEqual(formatQty({containerType:'20ft', containerCount:1}), '1 × 20 ft container', 'formats singular 20ft');
assertEqual(formatQty({qty:'24 MT'}), '24 MT', 'legacy metric-ton orders display unchanged');
assertEqual(formatQty({}), '—', 'missing quantity falls back safely');

// ---- Feature 2: inquiry / shipment date validation ----
function validateOrderDates(inquiryDate, shipDate, today) {
  if (inquiryDate > today) return 'Inquiry Received Date cannot be in the future.';
  if (shipDate < inquiryDate) return 'Expected Shipment Date cannot be earlier than the Inquiry Received Date.';
  return null;
}

const TODAY = new Date('2026-09-08');
assertEqual(validateOrderDates(new Date('2026-09-10'), new Date('2026-10-01'), TODAY),
  'Inquiry Received Date cannot be in the future.', 'rejects future inquiry date');
assertEqual(validateOrderDates(new Date('2026-09-01'), new Date('2026-08-30'), TODAY),
  'Expected Shipment Date cannot be earlier than the Inquiry Received Date.', 'rejects ship-before-inquiry');
assertEqual(validateOrderDates(new Date('2026-09-01'), new Date('2026-10-01'), TODAY),
  null, 'accepts a valid inquiry/ship pair');
assertEqual(validateOrderDates(TODAY, TODAY, TODAY), null, 'accepts inquiry date of exactly today');

// ---- Feature 3: document upload -> task -> workflow, atomically & idempotently ----
// A step only completes once every document type mapped to it is uploaded —
// for a single-document step that's just the one document.
function makeOrder(doneCount) { return { doneCount, docSteps: [] }; }

function uploadLinkedDocument(o, docs, stepIndex, docType, fileName, groupDocTypes) {
  if (stepIndex > o.doneCount) return { o, docs }; // locked — no-op, mirrors the UI guard
  docs = docs.filter(d => d.docType !== docType); // idempotent: replace, don't duplicate
  docs.push({ docType, fileName, uploadedAt: 'now' });
  const groupComplete = groupDocTypes.every(dt => docs.some(d => d.docType === dt));
  if (groupComplete && stepIndex === o.doneCount) {
    o.doneCount++;
    if (!o.docSteps.includes(stepIndex)) o.docSteps.push(stepIndex);
  }
  return { o, docs };
}

function deleteLinkedDocument(o, docs, stepIndex, docType) {
  docs = docs.filter(d => d.docType !== docType);
  const wasDocCompleted = o.docSteps.includes(stepIndex);
  if (wasDocCompleted && stepIndex === o.doneCount - 1) {
    o.doneCount--;
    o.docSteps = o.docSteps.filter(i => i !== stepIndex);
  } else {
    o.docSteps = o.docSteps.filter(i => i !== stepIndex);
  }
  return { o, docs };
}

// Uploading the current step's document completes the task and advances doneCount.
{
  let o = makeOrder(3);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 3, 'Proforma Invoice', 'pi.pdf', ['Proforma Invoice']));
  assertEqual(o.doneCount, 4, 'upload of current step advances doneCount');
  assertEqual(o.docSteps, [3], 'upload of current step recorded as via-document');
  assertEqual(docs.length, 1, 'document recorded once');
}

// Uploading a future (locked) step's document is a no-op.
{
  let o = makeOrder(3);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 5, 'Purchase Order', 'po.pdf', ['Purchase Order']));
  assertEqual(o.doneCount, 3, 'locked step upload does not advance doneCount');
  assertEqual(docs.length, 0, 'locked step upload records nothing');
}

// Re-uploading the same document type replaces the record, doesn't duplicate
// or double-advance an already-completed step.
{
  let o = makeOrder(3);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 3, 'Proforma Invoice', 'pi-v1.pdf', ['Proforma Invoice']));
  ({ o, docs } = uploadLinkedDocument(o, docs, 3, 'Proforma Invoice', 'pi-v2.pdf', ['Proforma Invoice']));
  assertEqual(o.doneCount, 4, 'doneCount does not double-advance on re-upload');
  assertEqual(docs.length, 1, 'no duplicate document record');
  assertEqual(docs[0].fileName, 'pi-v2.pdf', 're-upload replaces the file metadata');
}

// Deleting the most-recently-completed doc-linked step reverts it.
{
  let o = makeOrder(3);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 3, 'Proforma Invoice', 'pi.pdf', ['Proforma Invoice']));
  ({ o, docs } = deleteLinkedDocument(o, docs, 3, 'Proforma Invoice'));
  assertEqual(o.doneCount, 3, 'delete reverts doneCount when nothing later has progressed');
  assertEqual(o.docSteps, [], 'delete clears the via-document flag');
  assertEqual(docs.length, 0, 'delete removes the document record');
}

// Deleting a doc-linked step after later steps have already progressed does
// NOT cascade-undo those later steps — only the document record is removed.
{
  let o = makeOrder(3);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 3, 'Proforma Invoice', 'pi.pdf', ['Proforma Invoice'])); // doneCount -> 4
  o.doneCount = 6; // simulate later manual progress past this step
  ({ o, docs } = deleteLinkedDocument(o, docs, 3, 'Proforma Invoice'));
  assertEqual(o.doneCount, 6, 'later progress is not cascaded away by an earlier delete');
  assertEqual(docs.length, 0, 'document record still removed');
}

// "Prepare Documentation" (step 11) needs all three of Commercial Invoice,
// Packing List, and Certificate of Origin — uploading just one or two must
// NOT complete the task.
{
  const group = ['Commercial Invoice', 'Packing List', 'Certificate of Origin'];
  let o = makeOrder(11);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Commercial Invoice', 'ci.pdf', group));
  assertEqual(o.doneCount, 11, 'one of three uploaded does not complete the shared task');
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Packing List', 'pl.pdf', group));
  assertEqual(o.doneCount, 11, 'two of three uploaded still does not complete the shared task');
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Certificate of Origin', 'coo.pdf', group));
  assertEqual(o.doneCount, 12, 'all three uploaded completes the shared task');
  assertEqual(o.docSteps, [11], 'shared task recorded as via-document once complete');
}

// Removing any one document from a completed group reverts the shared task,
// since the "all documents present" requirement is broken again.
{
  const group = ['Commercial Invoice', 'Packing List', 'Certificate of Origin'];
  let o = makeOrder(11);
  let docs = [];
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Commercial Invoice', 'ci.pdf', group));
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Packing List', 'pl.pdf', group));
  ({ o, docs } = uploadLinkedDocument(o, docs, 11, 'Certificate of Origin', 'coo.pdf', group));
  ({ o, docs } = deleteLinkedDocument(o, docs, 11, 'Packing List'));
  assertEqual(o.doneCount, 11, 'removing one document from a complete group reverts the shared task');
  assertEqual(docs.map(d => d.docType).sort(), ['Certificate of Origin', 'Commercial Invoice'], 'the other two documents remain recorded');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
