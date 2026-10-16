// Keyed by "ServiceName.MethodName". Values:
//   'public'  — no auth required at all
//   'any'     — any authenticated role (client or admin-family)
//   'internal'— FlBridgeService shared-secret + IP allowlist, not JWT (see internal.interceptor.js)
//   [roles]   — JWT required, role must be in this list
export const RBAC_RULES = {
  // AuthService
  'AuthService.Register': 'public',
  'AuthService.ClientLogin': 'public',
  'AuthService.AdminLogin': 'public',
  'AuthService.RefreshToken': 'public', // authenticates via the refresh_token field itself, not a bearer JWT
  'AuthService.Logout': 'any',
  'AuthService.RotateClientKey': ['admin', 'super_admin'],
  'AuthService.CreateAdminUser': ['super_admin'],
  'AuthService.GetMe': 'any',

  // ClientService — every method is sdk_client-scoped
  'ClientService.GetStatus': ['sdk_client'],
  'ClientService.GetCurrentRound': ['sdk_client'],
  'ClientService.JoinRound': ['sdk_client'],
  'ClientService.LeaveRound': ['sdk_client'],
  'ClientService.GetModelDownload': ['sdk_client'],
  'ClientService.SubmitUpdate': ['sdk_client'],
  'ClientService.GetUpdateStatus': ['sdk_client'],
  'ClientService.GetSelfMetrics': ['sdk_client'],
  'ClientService.Heartbeat': ['sdk_client'],
  'ClientService.GetConfig': ['sdk_client'],

  // FlBridgeService — internal shared-secret, except GetFlStatus (dual: internal OR super_admin JWT)
  'FlBridgeService.TriggerRound': 'internal',
  'FlBridgeService.CompleteRound': 'internal',
  'FlBridgeService.GetRoundUpdates': 'internal',
  'FlBridgeService.PushModel': 'internal',
  'FlBridgeService.GetFlStatus': 'internal-or-super-admin',
  'FlBridgeService.ComputeUtility': 'internal',
  'FlBridgeService.GetFlConfig': 'internal',

  // AdminService
  'AdminService.GetOverview': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.ListClients': ['super_admin', 'admin'],
  'AdminService.GetClientDetail': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.BanClient': ['super_admin', 'admin'],
  'AdminService.UnbanClient': ['super_admin', 'admin'],
  'AdminService.DeleteClient': ['super_admin'],
  'AdminService.ListRounds': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.GetRoundDetail': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.StartRound': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.StopRound': ['super_admin', 'admin'],
  'AdminService.ListRoundUpdates': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.GetConvergenceMetrics': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.GetClientMetrics': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.GetCommunicationMetrics': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.GetFairnessMetrics': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.GetConfig': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.UpdateConfig': ['super_admin'],
  'AdminService.GetConfigHistory': ['super_admin', 'admin'],
  'AdminService.ListModels': ['super_admin', 'admin', 'fl_engineer', 'viewer'],
  'AdminService.GetModelDownload': ['super_admin', 'admin', 'fl_engineer'],
  'AdminService.DeleteModel': ['super_admin'],
  'AdminService.GetLogs': ['super_admin', 'admin'],
  'AdminService.ListUsers': ['super_admin'],
  'AdminService.UpdateUserRole': ['super_admin'],
  'AdminService.DeleteUser': ['super_admin'],

  // SystemService
  'SystemService.HealthCheck': 'public',
  'SystemService.GetVersion': 'public',
  'SystemService.GetPublicConfig': 'public',
  'SystemService.GetStats': ['super_admin', 'admin'],
  'SystemService.SetMaintenance': ['super_admin'],
  'SystemService.FlushCache': ['super_admin'],

  // EventStreamService
  'EventStreamService.Subscribe': 'any',
};

export function ruleFor(serviceName, methodName) {
  return RBAC_RULES[`${serviceName}.${methodName}`];
}

// Routes gated behind maintenance mode when it's active (client + FL traffic only —
// admin/system routes stay reachable so an admin can turn maintenance mode back off).
export function isMaintenanceGated(serviceName) {
  return serviceName === 'ClientService' || serviceName === 'FlBridgeService';
}
