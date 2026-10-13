/**
 * The audit trail must never contain a raw network address.
 *
 * This is a regression test for a real bug: `handle()` logged blocked requests
 * with `detail.ip` set to the address itself, and `audit_log` carries an
 * `audit_read_own` SELECT policy, so a signed-in user could read their own
 * location back out of the trail.
 *
 * Rather than assert on the helper in isolation, these tests drive the actual
 * wrapper every route uses, capture the row it hands the database, and scan
 * the whole serialised row for anything shaped like an IPv4 or IPv6 address.
 * That is what makes it a regression test: re-adding `ip: clientIp(request)`
 * anywhere in the guard path fails it, however the field is named.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PER_WINDOW } from "./guards";

/** Every row the code under test tried to insert, in order. */
const inserted: { table: string; row: Record<string, unknown> }[] = [];

vi.mock("./db", () => ({
  db: () => ({
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

const { handle } = await import("./trust");
const { resetIpLimiter, resetSaltWarning } = await import("./guards");

/** Anything shaped like an address. Deliberately loose — a false positive here
 *  costs a minute of reading; a false negative is the bug coming back. */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b|::1\b|\bfe80::/;

const CLIENT_IP = "203.0.113.7";
const CLIENT_IPV6 = "2001:db8::8a2e:370:7334";

/** A handler that would be a test failure if a guard ever let it run. */
const neverRuns = handle(async () => {
  throw new Error("the guard should have refused this request");
});

function request(headers: Record<string, string>): Request {
  return new Request("https://pot.example/api/trust/attest-day", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ poolId: 1 }),
  });
}

/** The audit rows written so far, as one string, for pattern scanning. */
function auditedText(): string {
  return JSON.stringify(inserted.filter((i) => i.table === "audit_log"));
}

function lastAuditDetail(): Record<string, unknown> {
  const rows = inserted.filter((i) => i.table === "audit_log");
  expect(rows.length).toBeGreaterThan(0);
  return rows[rows.length - 1]!.row.detail as Record<string, unknown>;
}

beforeEach(() => {
  inserted.length = 0;
  resetIpLimiter();
  resetSaltWarning();
  process.env.IP_HASH_SALT = "test-salt-not-a-real-one";
});

afterEach(() => {
  delete process.env.IP_HASH_SALT;
});

describe("audit rows for a cross-origin rejection", () => {
  it("records a hash, and no address in any field", async () => {
    const response = await neverRuns(
      request({ origin: "https://evil.example", "x-forwarded-for": CLIENT_IP })
    );

    expect(response.status).toBe(403);

    const detail = lastAuditDetail();
    expect(detail.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail).not.toHaveProperty("ip");

    // The whole row, not just the field we expect it in.
    expect(auditedText()).not.toMatch(IPV4);
    expect(auditedText()).not.toContain(CLIENT_IP);
  });

  it("does not leak an IPv6 address either", async () => {
    const response = await neverRuns(
      request({ origin: "https://evil.example", "x-forwarded-for": CLIENT_IPV6 })
    );

    expect(response.status).toBe(403);
    expect(lastAuditDetail().ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditedText()).not.toMatch(IPV6);
    expect(auditedText()).not.toContain(CLIENT_IPV6);
  });
});

describe("audit rows for a rate-limit rejection", () => {
  it("records a hash, and no address in any field", async () => {
    const hot = () =>
      neverRuns(request({ origin: "https://pot.example", "x-forwarded-for": CLIENT_IP }));

    // A full minute's allowance passes the IP shield and fails later (no
    // Privy tokens on the request), so only the one after it is the
    // rate-limit rejection under test. Counted against the exported ceiling
    // rather than a number copied here, because that ceiling is deliberately
    // sized for a shared network and will be tuned again.
    for (let i = 0; i < MAX_PER_WINDOW; i++) await hot();
    const response = await hot();

    expect(response.status).toBe(429);

    const detail = lastAuditDetail();
    expect(detail.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditedText()).not.toMatch(IPV4);
    expect(auditedText()).not.toContain(CLIENT_IP);
  });
});

describe("the hash itself", () => {
  it("is stable for one address and different for another", async () => {
    const forOne = async (ip: string) => {
      inserted.length = 0;
      resetIpLimiter();
      await neverRuns(request({ origin: "https://evil.example", "x-forwarded-for": ip }));
      return lastAuditDetail().ip_hash as string;
    };

    const first = await forOne(CLIENT_IP);
    const again = await forOne(CLIENT_IP);
    const other = await forOne("198.51.100.4");

    expect(first).toBe(again);
    expect(first).not.toBe(other);
  });

  it("changes when the salt is rotated, so old rows stop correlating", async () => {
    const withSalt = async (salt: string) => {
      process.env.IP_HASH_SALT = salt;
      inserted.length = 0;
      resetIpLimiter();
      await neverRuns(
        request({ origin: "https://evil.example", "x-forwarded-for": CLIENT_IP })
      );
      return lastAuditDetail().ip_hash as string;
    };

    expect(await withSalt("salt-one")).not.toBe(await withSalt("salt-two"));
  });

  it("logs nothing rather than a weak hash when no salt is set", async () => {
    // An unsalted SHA-256 of an IPv4 address is reversible by brute force, so
    // the absence of a salt must mean no value — not a guessable one.
    delete process.env.IP_HASH_SALT;

    const response = await neverRuns(
      request({ origin: "https://evil.example", "x-forwarded-for": CLIENT_IP })
    );

    expect(response.status).toBe(403);
    expect(lastAuditDetail().ip_hash).toBeNull();
    expect(auditedText()).not.toMatch(IPV4);
    expect(auditedText()).not.toContain(CLIENT_IP);
  });

  it("is null when no address header arrived at all", async () => {
    const response = await neverRuns(request({ origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(lastAuditDetail().ip_hash).toBeNull();
  });
});
