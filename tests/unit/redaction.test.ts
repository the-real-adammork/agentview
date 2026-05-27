import { describe, expect, it } from "vitest";

import { maskPreviewSecrets } from "../../src/shared/redaction";

describe("maskPreviewSecrets", () => {
  it("masks environment-style secret assignments in previews", () => {
    const preview = maskPreviewSecrets(
      "OPENAI_API_KEY=sk-proj-abc123 SECRET_TOKEN=super-secret-value normal=value",
    );

    expect(preview).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(preview).toContain("SECRET_TOKEN=[REDACTED]");
    expect(preview).toContain("normal=value");
    expect(preview).not.toContain("sk-proj-abc123");
    expect(preview).not.toContain("super-secret-value");
  });

  it("masks bearer headers, AWS-style keys, JWTs, and opaque long tokens", () => {
    const preview = maskPreviewSecrets(
      [
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
        "aws_access_key_id=AKIAIOSFODNN7EXAMPLE",
        "session=0123456789abcdef0123456789abcdef0123456789abcdef",
      ].join(" "),
    );

    expect(preview).toContain("Authorization: Bearer [REDACTED]");
    expect(preview).toContain("aws_access_key_id=[REDACTED]");
    expect(preview).toContain("session=[REDACTED]");
    expect(preview).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(preview).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(preview).not.toContain("0123456789abcdef");
  });

  it("masks credentials embedded in git remote URLs without hiding the host", () => {
    const preview = maskPreviewSecrets("origin=https://user:ghp_secret123@github.com/acme/repo.git");

    expect(preview).toBe("origin=https://[REDACTED]@github.com/acme/repo.git");
    expect(preview).toContain("github.com/acme/repo.git");
    expect(preview).not.toContain("user:ghp_secret123");
  });

  it("reports whether redaction changed the preview when metadata is requested", () => {
    expect(maskPreviewSecrets("plain diagnostic line", { includeMetadata: true })).toEqual({
      text: "plain diagnostic line",
      redactionApplied: false,
    });
    expect(maskPreviewSecrets("DATABASE_PASSWORD=hunter2", { includeMetadata: true })).toEqual({
      text: "DATABASE_PASSWORD=[REDACTED]",
      redactionApplied: true,
    });
  });
});
