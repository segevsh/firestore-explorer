import type { auth } from "firebase-admin";

export interface AuthUser {
  uid: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  photoURL?: string;
  disabled: boolean;
  emailVerified: boolean;
  providerData: Array<{ providerId: string; uid: string; email?: string; displayName?: string }>;
  metadata: {
    creationTime?: string;
    lastSignInTime?: string;
    lastRefreshTime?: string;
  };
  customClaims?: Record<string, unknown>;
  tokensValidAfterTime?: string;
}

export interface AuthListResult {
  users: AuthUser[];
  pageToken?: string;
}

/**
 * Auth backed by the firebase-admin SDK — used for production connections.
 */
export class AuthService {
  constructor(private authInstance: auth.Auth) {}

  async listUsers(maxResults = 100, pageToken?: string): Promise<AuthListResult> {
    const result = await this.authInstance.listUsers(maxResults, pageToken);
    const users = result.users
      .map((u) => this.toAuthUser(u))
      .sort(sortByLastSignIn);
    return { users, pageToken: result.pageToken };
  }

  async getUser(uid: string): Promise<AuthUser> {
    const record = await this.authInstance.getUser(uid);
    return this.toAuthUser(record);
  }

  async searchUser(query: string): Promise<AuthUser> {
    const trimmed = query.trim();
    if (trimmed.includes("@")) {
      const record = await this.authInstance.getUserByEmail(trimmed);
      return this.toAuthUser(record);
    }
    if (trimmed.startsWith("+")) {
      const record = await this.authInstance.getUserByPhoneNumber(trimmed);
      return this.toAuthUser(record);
    }
    const record = await this.authInstance.getUser(trimmed);
    return this.toAuthUser(record);
  }

  private toAuthUser(record: auth.UserRecord): AuthUser {
    return {
      uid: record.uid,
      email: record.email,
      displayName: record.displayName,
      phoneNumber: record.phoneNumber,
      photoURL: record.photoURL,
      disabled: record.disabled,
      emailVerified: record.emailVerified,
      providerData: record.providerData.map((p) => ({
        providerId: p.providerId,
        uid: p.uid,
        email: p.email,
        displayName: p.displayName,
      })),
      metadata: {
        creationTime: record.metadata.creationTime,
        lastSignInTime: record.metadata.lastSignInTime,
        lastRefreshTime: record.metadata.lastRefreshTime ?? undefined,
      },
      customClaims: record.customClaims,
      tokensValidAfterTime: record.tokensValidAfterTime,
    };
  }
}

/**
 * Auth backed by the emulator REST API — no env vars needed.
 * Uses host:authPort from the connection config directly.
 */
export class EmulatorAuthService {
  private baseUrl: string;

  constructor(host: string, authPort: number, private projectId: string) {
    this.baseUrl = `http://${host}:${authPort}`;
  }

  private identityUrl(path: string): string {
    return `${this.baseUrl}/identitytoolkit.googleapis.com/v1/projects/${this.projectId}${path}`;
  }

  async listUsers(maxResults = 100, _pageToken?: string): Promise<AuthListResult> {
    const url = `${this.identityUrl("/accounts:batchGet")}?maxResults=${maxResults}`;
    const res = await fetch(url, {
      headers: { Authorization: "Bearer owner" },
    });
    if (!res.ok) {
      throw new Error(`Emulator auth error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const users = (data.users || [])
      .map((u: any) => this.toAuthUser(u))
      .sort(sortByLastSignIn);
    return { users };
  }

  async getUser(uid: string): Promise<AuthUser> {
    const res = await fetch(this.identityUrl("/accounts:lookup"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ localId: [uid] }),
    });
    if (!res.ok) {
      throw new Error(`Emulator auth error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (!data.users || data.users.length === 0) {
      throw new Error(`User not found: ${uid}`);
    }
    return this.toAuthUser(data.users[0]);
  }

  async searchUser(query: string): Promise<AuthUser> {
    const trimmed = query.trim();

    if (trimmed.includes("@")) {
      return this.lookupBy({ email: [trimmed] });
    }
    if (trimmed.startsWith("+")) {
      return this.lookupBy({ phoneNumber: [trimmed] });
    }
    return this.getUser(trimmed);
  }

  private async lookupBy(body: Record<string, unknown>): Promise<AuthUser> {
    const res = await fetch(this.identityUrl("/accounts:lookup"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Emulator auth error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (!data.users || data.users.length === 0) {
      throw new Error(`User not found: ${JSON.stringify(body)}`);
    }
    return this.toAuthUser(data.users[0]);
  }

  private toAuthUser(raw: any): AuthUser {
    return {
      uid: raw.localId,
      email: raw.email,
      displayName: raw.displayName,
      phoneNumber: raw.phoneNumber,
      photoURL: raw.photoUrl,
      disabled: raw.disabled ?? false,
      emailVerified: raw.emailVerified ?? false,
      providerData: (raw.providerUserInfo || []).map((p: any) => ({
        providerId: p.providerId,
        uid: p.rawId || p.federatedId,
        email: p.email,
        displayName: p.displayName,
      })),
      metadata: {
        creationTime: raw.createdAt ? new Date(Number(raw.createdAt)).toUTCString() : undefined,
        lastSignInTime: raw.lastLoginAt ? new Date(Number(raw.lastLoginAt)).toUTCString() : undefined,
        lastRefreshTime: raw.lastRefreshAt ? new Date(Number(raw.lastRefreshAt)).toUTCString() : undefined,
      },
      customClaims: raw.customAttributes ? JSON.parse(raw.customAttributes) : undefined,
      tokensValidAfterTime: raw.validSince ? new Date(Number(raw.validSince) * 1000).toUTCString() : undefined,
    };
  }
}

function sortByLastSignIn(a: AuthUser, b: AuthUser): number {
  const aTime = a.metadata.lastSignInTime ? new Date(a.metadata.lastSignInTime).getTime() : 0;
  const bTime = b.metadata.lastSignInTime ? new Date(b.metadata.lastSignInTime).getTime() : 0;
  return bTime - aTime;
}
