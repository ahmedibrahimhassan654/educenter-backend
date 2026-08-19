/**
 * Derive a student's access entitlement for a group.
 * Remaining credits come from the student's general wallet balance; MONTHLY
 * subscriptions grant access while active. Access requires at least one of
 * the two.
 */
export function computeEntitlement(
  purchases: any[],
  walletBalance: number = 0,
  now: Date = new Date()
): {
  remainingCredits: number;
  monthlyActive: boolean;
  monthlyExpiresAt: Date | null;
  hasAccess: boolean;
} {
  let monthlyActive = false;
  let monthlyExpiresAt: Date | null = null;

  for (const p of purchases) {
    if (p.type === "MONTHLY") {
      const exp = p.monthlyExpiresAt ? new Date(p.monthlyExpiresAt) : null;
      if (exp && exp > now) {
        monthlyActive = true;
        if (!monthlyExpiresAt || exp > monthlyExpiresAt) {
          monthlyExpiresAt = exp;
        }
      }
    }
  }

  const remainingCredits = Math.max(0, walletBalance);

  return {
    remainingCredits,
    monthlyActive,
    monthlyExpiresAt,
    hasAccess: monthlyActive || remainingCredits > 0,
  };
}