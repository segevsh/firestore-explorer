/**
 * Integration tests for auth service against real emulator and production.
 *
 * NOT part of CI/CD — run manually:
 *   npx vitest run test/integration/auth.integration.test.ts
 *
 * Prerequisites:
 *   - Firebase emulator running (auth on port 9039, firestore on port 9030)
 *   - Service account at test-project/.secrets/service-account.json (for prod tests)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { EmulatorAuthService, AuthService } from "../../src/services/authService";
import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";

const EMULATOR_HOST = "localhost";
const EMULATOR_AUTH_PORT = 9039;
const EMULATOR_FIRESTORE_PORT = 9030;
const PROJECT_ID = "guestwho-7e1f2y";
const SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  "../../test-project/.secrets/service-account.json"
);

/** Seed a user into the emulator via REST (batchCreate). */
async function seedEmulatorUser(user: {
  localId: string;
  email: string;
  displayName?: string;
}) {
  const url = `http://${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchCreate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ users: [user] }),
  });
  if (!res.ok) {
    throw new Error(`Failed to seed user: ${res.status} ${await res.text()}`);
  }
}

/** Delete all users from the emulator project. */
async function clearEmulatorUsers() {
  const url = `http://${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  await fetch(url, { method: "DELETE" });
}

describe("EmulatorAuthService", () => {
  let svc: EmulatorAuthService;

  beforeAll(async () => {
    svc = new EmulatorAuthService(EMULATOR_HOST, EMULATOR_AUTH_PORT, PROJECT_ID);

    // Clear and seed test users
    await clearEmulatorUsers();
    await seedEmulatorUser({
      localId: "user-alice",
      email: "alice@test.com",
      displayName: "Alice",
    });
    await seedEmulatorUser({
      localId: "user-bob",
      email: "bob@test.com",
      displayName: "Bob",
    });
    await seedEmulatorUser({
      localId: "user-charlie",
      email: "charlie@test.com",
      displayName: "Charlie",
    });
  });

  it("listUsers returns seeded users", async () => {
    const result = await svc.listUsers();
    expect(result.users.length).toBe(3);
    const emails = result.users.map((u) => u.email).sort();
    expect(emails).toEqual(["alice@test.com", "bob@test.com", "charlie@test.com"]);
  });

  it("getUser returns a specific user by UID", async () => {
    const user = await svc.getUser("user-alice");
    expect(user.uid).toBe("user-alice");
    expect(user.email).toBe("alice@test.com");
    expect(user.displayName).toBe("Alice");
  });

  it("searchUser by email", async () => {
    const user = await svc.searchUser("bob@test.com");
    expect(user.uid).toBe("user-bob");
    expect(user.email).toBe("bob@test.com");
  });

  it("searchUser by UID", async () => {
    const user = await svc.searchUser("user-charlie");
    expect(user.uid).toBe("user-charlie");
  });

  it("getUser throws for non-existent user", async () => {
    await expect(svc.getUser("no-such-user")).rejects.toThrow();
  });

  it("user shape has expected fields", async () => {
    const user = await svc.getUser("user-alice");
    expect(user).toHaveProperty("uid");
    expect(user).toHaveProperty("email");
    expect(user).toHaveProperty("disabled");
    expect(user).toHaveProperty("emailVerified");
    expect(user).toHaveProperty("providerData");
    expect(user).toHaveProperty("metadata");
    expect(typeof user.disabled).toBe("boolean");
  });
});

describe("Production AuthService", () => {
  let svc: AuthService;
  let app: admin.app.App;

  beforeAll(() => {
    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      console.warn("Skipping prod tests — no service account at", SERVICE_ACCOUNT_PATH);
      return;
    }
    app = admin.initializeApp(
      { credential: admin.credential.cert(SERVICE_ACCOUNT_PATH) },
      "integration-test-prod"
    );
    svc = new AuthService(app.auth());
  });

  it("listUsers returns users from production", async () => {
    if (!svc) return;
    const result = await svc.listUsers(5);
    expect(result.users.length).toBeGreaterThan(0);
    expect(result.users[0]).toHaveProperty("uid");
    expect(result.users[0]).toHaveProperty("email");
  });

  it("getUser returns a valid user", async () => {
    if (!svc) return;
    const list = await svc.listUsers(1);
    const uid = list.users[0].uid;
    const user = await svc.getUser(uid);
    expect(user.uid).toBe(uid);
  });
});

describe("Concurrent emulator + production auth", () => {
  let emulatorSvc: EmulatorAuthService;
  let prodSvc: AuthService | null = null;
  let prodApp: admin.app.App;

  beforeAll(async () => {
    emulatorSvc = new EmulatorAuthService(EMULATOR_HOST, EMULATOR_AUTH_PORT, PROJECT_ID);

    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      prodApp = admin.initializeApp(
        { credential: admin.credential.cert(SERVICE_ACCOUNT_PATH) },
        "integration-test-concurrent"
      );
      prodSvc = new AuthService(prodApp.auth());
    }

    // Ensure emulator has users
    await clearEmulatorUsers();
    await seedEmulatorUser({
      localId: "concurrent-user",
      email: "concurrent@test.com",
      displayName: "Concurrent",
    });
  });

  it("emulator and production can fetch users at the same time", async () => {
    const emulatorPromise = emulatorSvc.listUsers();

    if (prodSvc) {
      const [emulatorResult, prodResult] = await Promise.all([
        emulatorPromise,
        prodSvc.listUsers(5),
      ]);

      // Emulator should have our seeded user
      expect(emulatorResult.users.some((u) => u.email === "concurrent@test.com")).toBe(true);
      // Prod should have real users
      expect(prodResult.users.length).toBeGreaterThan(0);
      // They should be different datasets
      expect(emulatorResult.users[0].uid).not.toBe(prodResult.users[0].uid);
    } else {
      // No prod service account — just verify emulator works
      const result = await emulatorPromise;
      expect(result.users.some((u) => u.email === "concurrent@test.com")).toBe(true);
    }
  });

  it("interleaved calls don't cross-contaminate", async () => {
    if (!prodSvc) return;

    // Fire multiple interleaved requests
    const results = await Promise.all([
      emulatorSvc.listUsers(),
      prodSvc.listUsers(3),
      emulatorSvc.getUser("concurrent-user"),
      prodSvc.listUsers(2),
      emulatorSvc.listUsers(),
    ]);

    const [emu1, prod1, emuUser, prod2, emu2] = results;

    // Emulator results should be consistent
    expect(emu1.users.length).toBe(emu2.users.length);
    expect(emuUser.email).toBe("concurrent@test.com");

    // Prod results should have real data
    expect(prod1.users.length).toBeGreaterThan(0);
    expect(prod2.users.length).toBeGreaterThan(0);
  });
});

describe("Multiple emulator projects concurrently", () => {
  const PROJECT_A = "project-alpha";
  const PROJECT_B = "project-beta";
  let svcA: EmulatorAuthService;
  let svcB: EmulatorAuthService;

  async function seedUser(projectId: string, user: { localId: string; email: string; displayName?: string }) {
    const url = `http://${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchCreate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ users: [user] }),
    });
    if (!res.ok) {
      throw new Error(`Failed to seed user: ${res.status} ${await res.text()}`);
    }
  }

  async function clearUsers(projectId: string) {
    const url = `http://${EMULATOR_HOST}:${EMULATOR_AUTH_PORT}/emulator/v1/projects/${projectId}/accounts`;
    await fetch(url, { method: "DELETE" });
  }

  beforeAll(async () => {
    svcA = new EmulatorAuthService(EMULATOR_HOST, EMULATOR_AUTH_PORT, PROJECT_A);
    svcB = new EmulatorAuthService(EMULATOR_HOST, EMULATOR_AUTH_PORT, PROJECT_B);

    await clearUsers(PROJECT_A);
    await clearUsers(PROJECT_B);

    // Seed different users in each project
    await seedUser(PROJECT_A, { localId: "alpha-1", email: "alpha1@test.com", displayName: "Alpha One" });
    await seedUser(PROJECT_A, { localId: "alpha-2", email: "alpha2@test.com", displayName: "Alpha Two" });
    await seedUser(PROJECT_B, { localId: "beta-1", email: "beta1@test.com", displayName: "Beta One" });
  });

  it("each project sees only its own users", async () => {
    const [resultA, resultB] = await Promise.all([
      svcA.listUsers(),
      svcB.listUsers(),
    ]);

    expect(resultA.users.length).toBe(2);
    expect(resultB.users.length).toBe(1);

    const emailsA = resultA.users.map((u) => u.email).sort();
    expect(emailsA).toEqual(["alpha1@test.com", "alpha2@test.com"]);
    expect(resultB.users[0].email).toBe("beta1@test.com");
  });

  it("concurrent getUser across projects returns correct user", async () => {
    const [userA, userB] = await Promise.all([
      svcA.getUser("alpha-1"),
      svcB.getUser("beta-1"),
    ]);

    expect(userA.uid).toBe("alpha-1");
    expect(userA.email).toBe("alpha1@test.com");
    expect(userB.uid).toBe("beta-1");
    expect(userB.email).toBe("beta1@test.com");
  });

  it("concurrent search across projects returns correct user", async () => {
    const [userA, userB] = await Promise.all([
      svcA.searchUser("alpha2@test.com"),
      svcB.searchUser("beta1@test.com"),
    ]);

    expect(userA.uid).toBe("alpha-2");
    expect(userB.uid).toBe("beta-1");
  });

  it("interleaved calls across projects don't leak", async () => {
    const results = await Promise.all([
      svcA.listUsers(),
      svcB.listUsers(),
      svcA.getUser("alpha-2"),
      svcB.getUser("beta-1"),
      svcA.listUsers(),
      svcB.listUsers(),
    ]);

    const [listA1, listB1, userA, userB, listA2, listB2] = results;

    // Lists should be consistent across calls
    expect(listA1.users.length).toBe(listA2.users.length);
    expect(listB1.users.length).toBe(listB2.users.length);

    // Users from correct projects
    expect(userA.email).toBe("alpha2@test.com");
    expect(userB.email).toBe("beta1@test.com");

    // No cross-contamination
    const allAEmails = listA1.users.map((u) => u.email);
    const allBEmails = listB1.users.map((u) => u.email);
    expect(allAEmails.every((e) => e?.includes("alpha"))).toBe(true);
    expect(allBEmails.every((e) => e?.includes("beta"))).toBe(true);
  });
});
