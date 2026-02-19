/**
 * Manager Approval Code Configuration
 *
 * The MANAGER_APPROVAL_CODE environment variable MUST be set.
 * No hardcoded fallbacks — fail fast if not configured.
 */

let _cachedCode: string | null = null;

export function getManagerApprovalCode(): string {
  if (_cachedCode) return _cachedCode;

  const code = process.env.MANAGER_APPROVAL_CODE;
  if (!code) {
    throw new Error(
      'MANAGER_APPROVAL_CODE environment variable is not set. ' +
      'Set it via: firebase functions:config:set app.manager_approval_code="YOUR_CODE"'
    );
  }

  _cachedCode = code;
  return code;
}

/**
 * Validate an approval code against the configured manager approval code.
 * Returns true if the code matches.
 */
export function isValidApprovalCode(code: string): boolean {
  try {
    return code === getManagerApprovalCode();
  } catch {
    // If env var not set, no code is valid
    console.error('MANAGER_APPROVAL_CODE not configured — all approval attempts will fail');
    return false;
  }
}
