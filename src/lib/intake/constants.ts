// Tunable settings for the email intake. Change them here, in one place.

// Below this overall confidence, an email goes to "Needs review" instead of
// being routed. (The Inquiry Board uses the same default to flag weak fields.)
export const CONFIDENCE_THRESHOLD = 0.7;

// How long the team has to reply, counted from when the email was received.
export const REPLY_WINDOW_HOURS = 24;

// Emails longer than this are cut before being sent to the AI (cost + safety).
export const MAX_BODY_CHARS = 12000;

export const DEFAULT_MODEL = "claude-sonnet-5-5";

// An order that has not finished all 15 steps is "open".
export const TOTAL_STEPS = 15;

// Order ids look like AA-2026-023.
export const ORDER_ID_PATTERN = /\bAA-\d{4}-\d{3}\b/gi;

// n8n nudges when this many hours (or fewer) are left on the 24h reply timer
export const REMINDER_LEAD_HOURS = 4;

// A known customer clearly repeating an earlier order ("same as last time") has fewer details in the
// email by nature, so the AI's overall score is lower. For that case only, this lower bar applies.
export const REPEAT_ORDER_THRESHOLD = 0.4;
// A saved reply draft longer than this is refused (Gmail and n8n choke on huge bodies).
export const MAX_DRAFT_CHARS = 20000;
