export const ROUTES = {
  seeker: ['/', '/chat', '/directory', '/map', '/saved', '/profile'],
  host: ['/org', '/services', '/locations', '/admins', '/claim'],
  communityAdmin: ['/queue', '/verify', '/coverage'],
  oranAdmin: ['/approvals', '/rules', '/audit', '/zone-management', '/ingestion'],
} as const;
