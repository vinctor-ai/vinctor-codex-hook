import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseAndClassifyUrl } from "../src/url.js";
import { ParseUnsafeError } from "../src/errors.js";

describe("parseAndClassifyUrl — host classification", () => {
  it("classifies localhost as internal", () => {
    assert.deepEqual(
      parseAndClassifyUrl("http://localhost:8080/health"),
      { host: "localhost", scope: "internal" },
    );
  });
  it("classifies 127.0.0.1 / 127.x.x.x as internal", () => {
    assert.equal(parseAndClassifyUrl("http://127.0.0.1/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://127.5.6.7/x").scope, "internal");
  });
  it("classifies RFC1918 private as internal", () => {
    assert.equal(parseAndClassifyUrl("http://10.0.0.1/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://172.16.0.5/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://172.31.255.1/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://192.168.1.1/x").scope, "internal");
  });
  it("classifies 169.254.x.x link-local as internal", () => {
    assert.equal(parseAndClassifyUrl("http://169.254.0.1/x").scope, "internal");
  });
  it("classifies ::1 IPv6 loopback as internal", () => {
    assert.equal(parseAndClassifyUrl("http://[::1]/x").scope, "internal");
  });
  it("classifies fc00::/7 IPv6 ULA as internal", () => {
    assert.equal(parseAndClassifyUrl("http://[fc00::1]/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://[fd12:3456::1]/x").scope, "internal");
  });
  it("classifies fe80::/10 IPv6 link-local as internal", () => {
    assert.equal(parseAndClassifyUrl("http://[fe80::1]/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://[feb0::1]/x").scope, "internal");
  });
  it("classifies *.local as internal", () => {
    assert.equal(parseAndClassifyUrl("http://printer.local/x").scope, "internal");
    assert.equal(parseAndClassifyUrl("http://my-mac.LOCAL/x").scope, "internal");
  });
  it("classifies public hosts as external", () => {
    assert.equal(parseAndClassifyUrl("https://api.example.com/v1").scope, "external");
    assert.equal(parseAndClassifyUrl("https://8.8.8.8/").scope, "external");
    assert.equal(parseAndClassifyUrl("https://[2001:db8::1]/").scope, "external");
  });

  it("lowercases the host", () => {
    assert.equal(parseAndClassifyUrl("https://API.Example.COM/x").host, "api.example.com");
  });

  it("strips userinfo, query, and fragment from the host result", () => {
    const r = parseAndClassifyUrl("https://user:pass@api.example.com/v1?token=abc#section");
    assert.equal(r.host, "api.example.com");
    assert.equal(r.scope, "external");
    // No leakage of userinfo / query / fragment
    assert.doesNotMatch(JSON.stringify(r), /token/);
    assert.doesNotMatch(JSON.stringify(r), /pass/);
    assert.doesNotMatch(JSON.stringify(r), /section/);
  });

  it("throws ParseUnsafeError on unparseable URL", () => {
    assert.throws(() => parseAndClassifyUrl("not a url"), ParseUnsafeError);
  });
  it("throws ParseUnsafeError on URL with embedded null byte", () => {
    assert.throws(() => parseAndClassifyUrl("http://example\0.com/"), ParseUnsafeError);
  });
  it("throws ParseUnsafeError on missing host", () => {
    // file:// scheme; URL parses but hostname is empty.
    assert.throws(() => parseAndClassifyUrl("file:///etc/passwd"), ParseUnsafeError);
  });
});
