export interface RedactionResult {
  text: string;
  redactionApplied: boolean;
}

export interface RedactionOptions {
  includeMetadata?: boolean;
}

const REDACTED = "[REDACTED]";

const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY_ID|BASE_INSTRUCTIONS)[A-Z0-9_]*|aws_access_key_id|session)\s*[:=]\s*([^\s]+)/gi;
const BASE_INSTRUCTIONS_INLINE = /\b(BASE_INSTRUCTIONS)\s*[:=]\s*[^.]+/gi;
const BEARER_HEADER = /\b(Authorization:\s*Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;
const CREDENTIALED_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi;
const BASE_INSTRUCTIONS_BLOCK = /(<base_instructions>)([\s\S]*?)(<\/base_instructions>)/gi;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const LONG_OPAQUE = /\b[0-9a-fA-F]{32,}\b/g;

export function maskPreviewSecrets(text: string, options: { includeMetadata: true }): RedactionResult;
export function maskPreviewSecrets(text: string, options?: RedactionOptions): string;
export function maskPreviewSecrets(text: string, options?: RedactionOptions): string | RedactionResult {
  const masked = text
    .replace(BASE_INSTRUCTIONS_BLOCK, `$1${REDACTED}$3`)
    .replace(BASE_INSTRUCTIONS_INLINE, `$1=${REDACTED}`)
    .replace(CREDENTIALED_URL, `$1${REDACTED}@`)
    .replace(BEARER_HEADER, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, `$1=${REDACTED}`)
    .replace(AWS_ACCESS_KEY, REDACTED)
    .replace(JWT, REDACTED)
    .replace(LONG_OPAQUE, REDACTED);

  const redactionApplied = masked !== text;

  if (options?.includeMetadata) {
    return {
      text: masked,
      redactionApplied,
    };
  }

  return masked;
}
