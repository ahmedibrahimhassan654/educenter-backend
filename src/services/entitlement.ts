/**
 * Derive a student's access entitlement from their purchases for a group.
 * LECTURES packs contribute remaining credits; MONTHLY subscriptions grant
 * access while active. Access requires at least one of the two.
 */
export function computeEntitlement(
  purchases: any[],
  now: Date = new Date()
): {
  remainingCredits: number;
  monthlyActive: boolean;
  monthlyExpiresAt: Date | null;
  hasAccess: boolean;
} {
  let remainingCredits = 0;
  let monthlyActive = false;
  let monthlyExpiresAt: Date | null = null;

  for (const p of purchases) {
    if (p.type === "LECTURES") {
      remainingCredits += p.remainingLectures || 0;
    } else if (p.type === "MONTHLY") {
      const exp = p.monthlyExpiresAt ? new Date(p.monthlyExpiresAt) : null;
      if (exp && exp > now) {
        monthlyActive = true;
        if (!monthlyExpiresAt || exp > monthlyExpiresAt) {
          monthlyExpiresAt = exp;
        }
      }
    }
  }

  return {
    remainingCredits,
    monthlyActive,
    monthlyExpiresAt,
    hasAccess: monthlyActive || remainingCredits > 0,
  };
}