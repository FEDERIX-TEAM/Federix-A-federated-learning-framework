import { createHash, randomBytes } from "node:crypto";
import { createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AdminService } from "../../src/gen/admin_pb";
import { AuthService } from "../../src/gen/auth_pb";
import { ClientService } from "../../src/gen/client_pb";
import { FlBridgeService } from "../../src/gen/fl_bridge_pb";
import { FlServerState } from "../../src/gen/common_pb";
import { readState } from "./stack";

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

export class Federation {
  private readonly transport = createConnectTransport({ baseUrl: readState().apiUrl, useBinaryFormat: true });
  readonly auth: Client<typeof AuthService> = createClient(AuthService, this.transport);
  readonly admin: Client<typeof AdminService> = createClient(AdminService, this.transport);
  readonly client: Client<typeof ClientService> = createClient(ClientService, this.transport);
  readonly fl: Client<typeof FlBridgeService> = createClient(FlBridgeService, this.transport);
  private readonly internal = { headers: { "x-internal-service-token": readState().internalToken } };
  private adminToken = "";

  async signIn() {
    const { superAdmin } = readState();
    this.adminToken = (await this.auth.adminLogin({ email: superAdmin.email, password: superAdmin.password })).accessToken;
    return this;
  }

  private get asAdmin() {
    return bearer(this.adminToken);
  }

  async stopRunningRounds() {
    for (const status of ["active", "aggregating"]) {
      for await (const r of this.admin.listRounds({ status, limit: 50 }, this.asAdmin)) {
        await this.admin.stopRound({ roundId: r.roundId, reason: "test reset" }, this.asAdmin).catch(() => undefined);
      }
    }
  }

  async latestRoundId(): Promise<string> {
    for await (const r of this.admin.listRounds({ page: 1, limit: 1 }, this.asAdmin)) return r.roundId;
    throw new Error("there are no rounds yet");
  }

  async latestModelVersion(): Promise<number> {
    let latest = 0;
    for await (const m of this.admin.listModels({}, this.asAdmin)) latest = Math.max(latest, m.modelVersion);
    return latest;
  }

  async uploadModel(version: number) {
    const { upload, resourcePath } = await this.fl.getModelUploadUrl({ modelVersion: version }, this.internal);
    const res = await fetch(upload!.url, { method: "PUT", body: randomBytes(2048) });
    if (res.status !== 201) throw new Error(`model upload failed: ${res.status}`);
    return resourcePath;
  }

  async ensureModel() {
    if ((await this.latestModelVersion()) > 0) return;
    const path = await this.uploadModel(1);
    await this.fl.pushModel({ modelVersion: 1, weightsUrl: path }, this.internal);
  }

  async startRound(maxClients: number) {
    await this.admin.updateConfig({ minClientsPerRound: 1 }, this.asAdmin);
    return this.admin.startRound({ maxClients, deadlineSeconds: 900 }, this.asAdmin);
  }

  async newClient(name: string) {
    const { token } = await this.admin.createEnrollmentToken({ label: name, maxUses: 1, ttlHours: 1 }, this.asAdmin);
    const reg = await this.auth.register({ name, sdkVersion: "1.1.0", platform: "e2e", enrollmentToken: token });
    const session = await this.auth.clientLogin({ clientId: reg.clientId, apiKey: reg.apiKey });
    return { id: reg.clientId, auth: bearer(session.accessToken) };
  }

  async join(roundId: string, c: { auth: ReturnType<typeof bearer> }) {
    await this.client.joinRound({ roundId, localDataSize: 500 }, c.auth);
  }

  async submit(roundId: string, c: { auth: ReturnType<typeof bearer> }) {
    const prepared = await this.client.prepareUpdate(
      { roundId, localLossBefore: 2.3, localLossAfter: 0.9, labelDistribution: { counts: { "0": 250, "1": 250 } }, dataSize: 500, trainingTimeMs: 20 },
      c.auth,
    );
    const body = randomBytes(4096);
    const res = await fetch(prepared.upload!.url, { method: "PUT", body });
    if (res.status !== 201) throw new Error(`update upload failed: ${res.status}`);
    await this.client.submitUpdate({ roundId, updateId: prepared.updateId, sha256: createHash("sha256").update(body).digest("hex") }, c.auth);
    return prepared.updateId;
  }

  async complete(roundId: string, accuracy: number, loss: number, rejectionReasons: Record<string, string> = {}) {
    await this.fl.triggerRound({ roundId }, this.internal);
    const usable: string[] = [];
    for await (const u of this.fl.getRoundUpdates({ roundId }, this.internal)) usable.push(u.updateId);
    const version = (await this.latestModelVersion()) + 1;
    const path = await this.uploadModel(version);
    await this.fl.completeRound(
      {
        roundId,
        newModelVersion: version,
        modelUrl: path,
        globalAccuracy: accuracy,
        globalLoss: loss,
        usedUpdateIds: usable.filter((id) => !(id in rejectionReasons)),
        rejectionReasons,
      },
      this.internal,
    );
    return version;
  }

  async reportFlServer(state: FlServerState, message: string, lastError = "") {
    await this.fl.reportFlStatus({ workerId: "brain-e2e", state, version: "0.1.0", message, lastError }, this.internal);
  }
}
