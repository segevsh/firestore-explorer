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

export class AuthService {
  constructor(private authInstance: auth.Auth) {}

  async listUsers(maxResults = 100, pageToken?: string): Promise<AuthListResult> {
    const result = await this.authInstance.listUsers(maxResults, pageToken);
    const users = result.users
      .map((u) => this.toAuthUser(u))
      .sort((a, b) => {
        // Sort by last sign-in time, most recent first
        const aTime = a.metadata.lastSignInTime ? new Date(a.metadata.lastSignInTime).getTime() : 0;
        const bTime = b.metadata.lastSignInTime ? new Date(b.metadata.lastSignInTime).getTime() : 0;
        return bTime - aTime;
      });
    return { users, pageToken: result.pageToken };
  }

  async getUser(uid: string): Promise<AuthUser> {
    const record = await this.authInstance.getUser(uid);
    return this.toAuthUser(record);
  }

  async searchUser(query: string): Promise<AuthUser> {
    // Try UID first, then email, then phone
    const trimmed = query.trim();

    // Email pattern
    if (trimmed.includes("@")) {
      const record = await this.authInstance.getUserByEmail(trimmed);
      return this.toAuthUser(record);
    }

    // Phone pattern (starts with +)
    if (trimmed.startsWith("+")) {
      const record = await this.authInstance.getUserByPhoneNumber(trimmed);
      return this.toAuthUser(record);
    }

    // Default: try as UID
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
