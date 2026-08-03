export function canAccessRoute(
  user: { id: string; role: string } | undefined,
  route: { userId: string }
): boolean {
  return !!user && (user.role === 'ADMIN' || route.userId === user.id);
}
