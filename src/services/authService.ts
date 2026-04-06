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
    return {
      users: result.users.map((u) => this.toAuthUser(u)),
      pageToken: result.pageToken,
    };
  }

  async getUser(uid: string): Promise<AuthUser> {
    const record = await this.authInstance.getUser(uid);
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
